"use strict";
/**
 * Profile Features for Baileys
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements: bio/about checker, profile picture update detection,
 * business profile compatibility, and profile metadata normalization.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeProfileSocket =
exports.normalizeProfileMetadata =
exports.isBusinessProfile =
void 0;

// ── Business Profile Detection ────────────────────────────────────────────────

/**
 * Detect if a profile is a WhatsApp Business account.
 * Checks for business-specific fields in the profile payload.
 */
const isBusinessProfile = (profile) => {
    if (!profile) return false;
    return !!(
        profile.businessProfile ||
        profile.isBusiness ||
        profile.verifiedName ||
        profile.website ||
        profile.email ||
        profile.category ||
        profile.description
    );
};
exports.isBusinessProfile = isBusinessProfile;

// ── Profile Metadata Normalization ────────────────────────────────────────────

/**
 * Normalize a raw WA profile object into a consistent structure.
 * Handles both personal and business profiles.
 *
 * @param raw  Raw profile data from WA query
 */
const normalizeProfileMetadata = (raw) => {
    if (!raw) return null;

    const isBiz = isBusinessProfile(raw);
    const bp = raw.businessProfile || {};

    return {
        jid: raw.jid || raw.id || null,
        name: raw.notify || raw.name || raw.pushName || null,
        about: raw.status || raw.about || null,
        profilePicUrl: raw.imgUrl || raw.profilePicUrl || null,
        isBusiness: isBiz,
        // Business-specific fields (null for personal accounts)
        business: isBiz ? {
            verifiedName: raw.verifiedName || bp.verifiedName || null,
            category: bp.category || null,
            description: bp.description || raw.description || null,
            email: bp.email || raw.email || null,
            website: (bp.websites || (raw.website ? [raw.website] : [])),
            address: bp.address || null,
        } : null,
        // Timestamps
        lastSeen: raw.lastSeen || null,
        updatedAt: Date.now(),
    };
};
exports.normalizeProfileMetadata = normalizeProfileMetadata;

// ── Profile Socket Extension ──────────────────────────────────────────────────

/**
 * Wraps a Baileys socket with profile utilities.
 *
 * @example
 * const sock = makeWASocket(config);
 * const profSock = makeProfileSocket(sock);
 *
 * const bio = await profSock.fetchBio('1234567890@s.whatsapp.net');
 * profSock.onProfilePicUpdate('1234567890@s.whatsapp.net', (url) => console.log('New pic:', url));
 */
const makeProfileSocket = (sock) => {
    // Internal cache for profile pictures to detect changes
    const _picCache = new Map();

    /**
     * Fetch the bio/about text of a contact.
     * Returns null if not available (privacy setting or no bio).
     */
    const fetchBio = async (jid) => {
        try {
            const result = await sock.fetchStatus(jid);
            if (!result) return null;
            return result.status || null;
        } catch {
            return null;
        }
    };

    /**
     * Fetch and normalize a profile, with business profile support.
     */
    const fetchNormalizedProfile = async (jid) => {
        try {
            const [status, ppUrl] = await Promise.allSettled([
                sock.fetchStatus(jid).catch(() => null),
                sock.profilePictureUrl(jid, 'image').catch(() => null),
            ]);

            const raw = {
                jid,
                status: status.status === 'fulfilled' ? status.value?.status : null,
                profilePicUrl: ppUrl.status === 'fulfilled' ? ppUrl.value : null,
            };

            // Try to enrich with business profile data if available
            try {
                if (typeof sock.getBusinessProfile === 'function') {
                    const bp = await sock.getBusinessProfile(jid);
                    if (bp) Object.assign(raw, { businessProfile: bp, isBusiness: true });
                }
            } catch { /* non-business account */ }

            return normalizeProfileMetadata(raw);
        } catch (err) {
            return null;
        }
    };

    /**
     * Check if a contact's profile picture has changed since last check.
     * Caches the last known URL and returns change details.
     *
     * @param jid  Contact JID
     * @returns    { changed, oldUrl, newUrl } or null on error
     */
    const checkProfilePicChange = async (jid) => {
        try {
            const newUrl = await sock.profilePictureUrl(jid, 'image').catch(() => null);
            const oldUrl = _picCache.get(jid) ?? null;
            _picCache.set(jid, newUrl);
            return {
                changed: oldUrl !== newUrl,
                oldUrl,
                newUrl,
            };
        } catch {
            return null;
        }
    };

    /**
     * Register a listener that fires when a contact's profile picture changes.
     * Polls at the given interval (default 5 minutes).
     *
     * @param jid          Contact JID to watch
     * @param onChanged    Callback(newUrl, oldUrl)
     * @param intervalMs   Poll interval in ms (default 300_000 = 5 min)
     * @returns            stop() function to cancel watching
     */
    const onProfilePicUpdate = (jid, onChanged, intervalMs = 300_000) => {
        // Seed the cache with current value
        sock.profilePictureUrl(jid, 'image').then(url => _picCache.set(jid, url)).catch(() => {});

        const timer = setInterval(async () => {
            const result = await checkProfilePicChange(jid);
            if (result?.changed) {
                onChanged(result.newUrl, result.oldUrl);
            }
        }, intervalMs);

        return { stop: () => clearInterval(timer) };
    };

    /**
     * Watch for contact updates (bio, name changes) via WA push events.
     * Uses the 'contacts.update' event already emitted by Baileys.
     *
     * @param jid         Contact JID to watch
     * @param onUpdated   Callback(normalizedProfile)
     */
    const onBioUpdate = (jid, onUpdated) => {
        const handler = async (updates) => {
            const update = updates.find(u => u.id === jid);
            if (!update) return;
            const profile = await fetchNormalizedProfile(jid);
            if (profile) onUpdated(profile);
        };
        sock.ev.on('contacts.update', handler);
        return { stop: () => sock.ev.off('contacts.update', handler) };
    };

    return {
        ...sock,
        fetchBio,
        fetchNormalizedProfile,
        checkProfilePicChange,
        onProfilePicUpdate,
        onBioUpdate,
    };
};
exports.makeProfileSocket = makeProfileSocket;
