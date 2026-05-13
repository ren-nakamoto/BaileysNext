"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchModernSocket = exports.normalizeStoryParticipant = void 0;

/**
 * May-2026 compatibility helpers for BaileysNext.
 * Non-breaking CJS layer: it does not replace the existing reaction relay
 * implementation copied from the friend's Baileys. It only exposes safer
 * high-level helpers on top of whatever low-level socket methods are present.
 */
const normalizeStoryParticipant = (keyOrMessage) => {
    const key = keyOrMessage?.key || keyOrMessage;
    return key?.participant || key?.remoteJid || keyOrMessage?.participant;
};
exports.normalizeStoryParticipant = normalizeStoryParticipant;

const ensureMessageKey = (keyOrMessage) => keyOrMessage?.key || keyOrMessage;
const ensureJid = (jid, field = 'jid') => {
    if (!jid || typeof jid !== 'string') {
        throw new Error(`${field} must be a non-empty WhatsApp JID`);
    }
    return jid;
};
const buildVCard = ({ jid, number, name, fullName, organization }) => {
    const phone = (number || jid || '').replace(/@.+$/, '').replace(/\D/g, '');
    const displayName = String(name || fullName || phone || 'Contact');
    const org = organization ? `ORG:${organization}\n` : '';
    return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${displayName}`,
        org.trim(),
        `TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}`,
        'END:VCARD'
    ].filter(Boolean).join('\n');
};

const patchModernSocket = (sock, options = {}) => {
    if (!sock || typeof sock !== 'object') {
        throw new Error('patchModernSocket(sock) requires a Baileys socket object');
    }
    if (sock.__baileysNextModernPatched) return sock;
    Object.defineProperty(sock, '__baileysNextModernPatched', { value: true, enumerable: false });

    /** React to a WhatsApp Status/Story using the friend's relay flow. */
    sock.reactStatus = async (keyOrMessage, emoji = '❤️', relayOptions = {}) => {
        if (typeof sock.relayMessage !== 'function') {
            throw new Error('reactStatus requires relayMessage support in lib/Socket/messages-send.js');
        }
        const key = ensureMessageKey(keyOrMessage);
        if (!key?.id) throw new Error('reactStatus requires a valid status message key');
        const participant = relayOptions.participant || (0, exports.normalizeStoryParticipant)(keyOrMessage);
        if (!participant) throw new Error('reactStatus requires status owner participant JID');
        return sock.relayMessage('status@broadcast', {
            reactionMessage: {
                key,
                text: emoji,
                senderTimestampMs: Date.now()
            }
        }, {
            statusJidList: [participant],
            additionalAttributes: { type: 'reaction', ...(relayOptions.additionalAttributes || {}) },
            ...relayOptions
        });
    };

    /** Alias for older/newer bot code. */
    sock.sendStatusReaction = sock.reactStatus;

    sock.readStatus = async (keyOrMessage, relayOptions = {}) => {
        const key = ensureMessageKey(keyOrMessage);
        const participant = relayOptions.participant || (0, exports.normalizeStoryParticipant)(keyOrMessage);
        if (typeof sock.readMessages === 'function') {
            return sock.readMessages([key]);
        }
        if (typeof sock.sendReceipt === 'function') {
            return sock.sendReceipt('status@broadcast', participant, [key.id], 'read');
        }
        throw new Error('readStatus requires readMessages or sendReceipt support');
    };

    sock.sendPollMessage = async (jid, name, values, selectableCount = 1, opts = {}) => {
        ensureJid(jid);
        if (!Array.isArray(values) || !values.length) throw new Error('values must be a non-empty array');
        return sock.sendMessage(jid, {
            poll: {
                name: String(name || 'Poll'),
                values: values.map(String),
                selectableCount: Number(selectableCount) || 1
            }
        }, opts);
    };

    sock.editMessage = async (jid, key, text, opts = {}) => {
        ensureJid(jid);
        if (!key?.id) throw new Error('editMessage requires original message key');
        return sock.sendMessage(jid, { text: String(text), edit: key }, opts);
    };

    sock.deleteMessage = async (jid, key, opts = {}) => {
        ensureJid(jid);
        if (!key?.id) throw new Error('deleteMessage requires original message key');
        return sock.sendMessage(jid, { delete: key }, opts);
    };

    sock.pinMessage = async (jid, key, seconds = 86400, opts = {}) => {
        ensureJid(jid);
        if (!key?.id) throw new Error('pinMessage requires original message key');
        return sock.sendMessage(jid, { pin: { type: 1, time: seconds, key } }, opts);
    };

    sock.unpinMessage = async (jid, key, opts = {}) => {
        ensureJid(jid);
        if (!key?.id) throw new Error('unpinMessage requires original message key');
        return sock.sendMessage(jid, { pin: { type: 0, time: 0, key } }, opts);
    };

    sock.sendContactCard = async (jid, contact, opts = {}) => {
        ensureJid(jid);
        const vcard = buildVCard(contact || {});
        const displayName = contact?.name || contact?.fullName || contact?.number || contact?.jid || 'Contact';
        return sock.sendMessage(jid, { contacts: { displayName, contacts: [{ vcard }] } }, opts);
    };

    sock.sendContacts = async (jid, contacts, opts = {}) => {
        ensureJid(jid);
        if (!Array.isArray(contacts) || !contacts.length) throw new Error('contacts must be a non-empty array');
        return sock.sendMessage(jid, {
            contacts: {
                displayName: `${contacts.length} contacts`,
                contacts: contacts.map(contact => ({ vcard: buildVCard(contact) }))
            }
        }, opts);
    };

    sock.sendAlbumMessage = async (jid, mediaItems, opts = {}) => {
        ensureJid(jid);
        if (!Array.isArray(mediaItems) || !mediaItems.length) throw new Error('mediaItems must be a non-empty array');
        const sent = [];
        for (const item of mediaItems) {
            sent.push(await sock.sendMessage(jid, item, opts));
        }
        return sent;
    };

    sock.archiveChat = async (jid, archive = true) => {
        ensureJid(jid);
        if (typeof sock.chatModify !== 'function') throw new Error('archiveChat requires chatModify support');
        return sock.chatModify({ archive }, jid);
    };

    sock.muteChat = async (jid, muteEndTimestamp = 8 * 60 * 60) => {
        ensureJid(jid);
        if (typeof sock.chatModify !== 'function') throw new Error('muteChat requires chatModify support');
        return sock.chatModify({ mute: muteEndTimestamp }, jid);
    };

    sock.unmuteChat = async (jid) => {
        ensureJid(jid);
        if (typeof sock.chatModify !== 'function') throw new Error('unmuteChat requires chatModify support');
        return sock.chatModify({ mute: null }, jid);
    };

    sock.requestPairingCodeSafe = async (phoneNumber) => {
        if (typeof sock.requestPairingCode !== 'function') {
            throw new Error('requestPairingCode is not available in this socket build');
        }
        const cleaned = String(phoneNumber || '').replace(/\D/g, '');
        if (!cleaned) throw new Error('phoneNumber is required');
        return sock.requestPairingCode(cleaned);
    };

    sock.newsletterMetadataSafe = async (jidOrInvite) => {
        const fn = sock.newsletterMetadata || sock.newsletterMetadataByInvite || sock.newsletterQuery;
        if (typeof fn !== 'function') throw new Error('newsletter metadata API is not available in this build');
        return fn.call(sock, jidOrInvite);
    };

    return sock;
};
exports.patchModernSocket = patchModernSocket;
exports.default = patchModernSocket;
