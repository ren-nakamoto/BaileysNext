"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeChatsSocket = void 0;
const boom_1 = require("@hapi/boom");
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const Types_1 = require("../Types");
const Utils_1 = require("../Utils");
const make_mutex_1 = require("../Utils/make-mutex");
const process_message_1 = __importDefault(require("../Utils/process-message"));
const WABinary_1 = require("../WABinary");
const socket_1 = require("./socket");
const WAUSync_1 = require("../WAUSync");
const usync_1 = require("./usync");
const MAX_SYNC_ATTEMPTS = 2;
const makeChatsSocket = (config) => {
    const { logger, markOnlineOnConnect, fireInitQueries, appStateMacVerification, shouldIgnoreJid, shouldSyncHistoryMessage, } = config;
    const sock = (0, usync_1.makeUSyncSocket)(config);
    const { ev, ws, authState, generateMessageTag, sendNode, query, onUnexpectedError, } = sock;
    let privacySettings;
    let needToFlushWithAppStateSync = false;
    let pendingAppStateSync = false;
    /** this mutex ensures that the notifications (receipts, messages etc.) are processed in order */
    const processingMutex = (0, make_mutex_1.makeMutex)();
    /** helper function to fetch the given app state sync key */
    const getAppStateSyncKey = async (keyId) => {
        const { [keyId]: key } = await authState.keys.get('app-state-sync-key', [keyId]);
        return key;
    };
    const fetchPrivacySettings = async (force = false) => {
        if (!privacySettings || force) {
            const { content } = await query({
                tag: 'iq',
                attrs: {
                    xmlns: 'privacy',
                    to: WABinary_1.S_WHATSAPP_NET,
                    type: 'get'
                },
                content: [
                    { tag: 'privacy', attrs: {} }
                ]
            });
            privacySettings = (0, WABinary_1.reduceBinaryNodeToDictionary)(content === null || content === void 0 ? void 0 : content[0], 'category');
        }
        return privacySettings;
    };
    /** helper function to run a privacy IQ query */
    const privacyQuery = async (name, value) => {
        await query({
            tag: 'iq',
            attrs: {
                xmlns: 'privacy',
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set'
            },
            content: [{
                    tag: 'privacy',
                    attrs: {},
                    content: [
                        {
                            tag: 'category',
                            attrs: { name, value }
                        }
                    ]
                }]
        });
    };
    const updateLastSeenPrivacy = async (value) => {
        await privacyQuery('last', value);
    };
    const updateOnlinePrivacy = async (value) => {
        await privacyQuery('online', value);
    };
    const updateProfilePicturePrivacy = async (value) => {
        await privacyQuery('profile', value);
    };
    const updateStatusPrivacy = async (value) => {
        await privacyQuery('status', value);
    };
    const updateReadReceiptsPrivacy = async (value) => {
        await privacyQuery('readreceipts', value);
    };
    const updateGroupsAddPrivacy = async (value) => {
        await privacyQuery('groupadd', value);
    };
    const updateDefaultDisappearingMode = async (duration) => {
        await query({
            tag: 'iq',
            attrs: {
                xmlns: 'disappearing_mode',
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set'
            },
            content: [{
                    tag: 'disappearing_mode',
                    attrs: {
                        duration: duration.toString()
                    }
                }]
        });
    };
    /** helper function to run a generic IQ query */
    const interactiveQuery = async (userNodes, queryNode) => {
        const result = await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'get',
                xmlns: 'usync',
            },
            content: [
                {
                    tag: 'usync',
                    attrs: {
                        sid: generateMessageTag(),
                        mode: 'query',
                        last: 'true',
                        index: '0',
                        context: 'interactive',
                    },
                    content: [
                        {
                            tag: 'query',
                            attrs: {},
                            content: [queryNode]
                        },
                        {
                            tag: 'list',
                            attrs: {},
                            content: userNodes
                        }
                    ]
                }
            ],
        });
        const usyncNode = (0, WABinary_1.getBinaryNodeChild)(result, 'usync');
        const listNode = (0, WABinary_1.getBinaryNodeChild)(usyncNode, 'list');
        const users = (0, WABinary_1.getBinaryNodeChildren)(listNode, 'user');
        return users;
    };
    const onWhatsApp = async (...jids) => {
        const query = { tag: 'contact', attrs: {} };
        const list = jids.map((jid) => {
            // insures only 1 + is there
            const content = `+${jid.replace('+', '')}`;
            return {
                tag: 'user',
                attrs: {},
                content: [{
                        tag: 'contact',
                        attrs: {},
                        content,
                    }],
            };
        });
        const results = await interactiveQuery(list, query);
        return results.map(user => {
            const contact = (0, WABinary_1.getBinaryNodeChild)(user, 'contact');
            return { exists: (contact === null || contact === void 0 ? void 0 : contact.attrs.type) === 'in', jid: user.attrs.jid };
        }).filter(item => item.exists);
    };
    const fetchStatus = async (jid) => {
        const [result] = await interactiveQuery([{ tag: 'user', attrs: { jid } }], { tag: 'status', attrs: {} });
        if (result) {
            const status = (0, WABinary_1.getBinaryNodeChild)(result, 'status');
            return {
                status: status === null || status === void 0 ? void 0 : status.content.toString(),
                setAt: new Date(+((status === null || status === void 0 ? void 0 : status.attrs.t) || 0) * 1000)
            };
        }
    };
    /**
     * Fetch bio/about of a contact including when it was set
     * @param jid the JID of the user
     */
    const fetchBio = async (jid) => {
        const [result] = await interactiveQuery([{ tag: 'user', attrs: { jid } }], { tag: 'status', attrs: {} });
        if (result) {
            const statusNode = (0, WABinary_1.getBinaryNodeChild)(result, 'status');
            if (statusNode) {
                const bioText = statusNode.content ? statusNode.content.toString() : '';
                const bioSetAt = new Date(+((statusNode.attrs.t) || 0) * 1000);
                return {
                    bio: bioText,
                    bioSetAt,
                    /** @deprecated use bio instead */ status: bioText,
                    /** @deprecated use bioSetAt instead */ setAt: bioSetAt
                };
            }
        }
        return undefined;
    };
    /**
     * React / like to a WhatsApp Status (SW) story
     * @param statusKey the message key of the status
     * @param emoji the emoji to react with, e.g. '❤️' or '🔥'. Pass null to remove reaction.
     */
    const sendStatusReaction = async (statusKey, emoji) => {
        const reactionContent = emoji
            ? { reactionMessage: { key: statusKey, text: emoji, senderTimestampMs: BigInt(Date.now()) } }
            : { reactionMessage: { key: statusKey, text: '', senderTimestampMs: BigInt(Date.now()) } };
        await sock.relayMessage(statusKey.remoteJid || 'status@broadcast', reactionContent, {
            statusJidList: [statusKey.participant || statusKey.remoteJid],
            additionalAttributes: { type: 'reaction' }
        });
    };
    /**
     * Like a WhatsApp Status (SW) with ❤️ emoji
     * @param statusKey the message key of the status to like
     */
    const sendStatusLike = async (statusKey) => {
        return sendStatusReaction(statusKey, '❤️');
    };
    /**
     * Mark a WhatsApp Status as viewed
     * @param statusKey the message key of the status
     */
    const sendStatusView = async (statusKey) => {
        await sendNode({
            tag: 'receipt',
            attrs: {
                type: 'read',
                to: statusKey.remoteJid || 'status@broadcast',
                id: statusKey.id,
                participant: statusKey.participant || authState.creds.me.id,
                t: Math.floor(Date.now() / 1000).toString()
            }
        });
    };
    /**
     * Check if a phone number is registered on WhatsApp
     * @param phoneNumber e.g. '628123456789' (without +)
     */
    const isRegisteredWA = async (phoneNumber) => {
        const results = await onWhatsApp(phoneNumber);
        return results && results.length > 0 ? results[0] : { exists: false, jid: null };
    };
    /**
     * Fetch common/mutual groups between you and a contact
     * @param jid the contact JID
     */
    const fetchCommonGroups = async (jid) => {
        const result = await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'get',
                xmlns: 'w:sync:contacts',
            },
            content: [{
                tag: 'groups',
                attrs: {},
                content: [{
                    tag: 'user',
                    attrs: { jid: (0, WABinary_1.jidNormalizedUser)(jid) }
                }]
            }]
        });
        const groupsNode = (0, WABinary_1.getBinaryNodeChild)(result, 'groups');
        if (!groupsNode) return [];
        return (0, WABinary_1.getBinaryNodeChildren)(groupsNode, 'group').map(n => n.attrs.jid).filter(Boolean);
    };
    /**
     * Fetch contact badge info (verified/business)
     * @param jid the contact JID
     */
    const fetchContactBadge = async (jid) => {
        const [result] = await interactiveQuery(
            [{ tag: 'user', attrs: { jid: (0, WABinary_1.jidNormalizedUser)(jid) } }],
            { tag: 'biz', attrs: {} }
        );
        if (!result) return { isBusiness: false, isVerified: false, verifiedName: undefined };
        const bizNode = (0, WABinary_1.getBinaryNodeChild)(result, 'biz');
        return {
            isBusiness: !!bizNode,
            isVerified: (bizNode === null || bizNode === void 0 ? void 0 : bizNode.attrs.verified_level) === 'full',
            verifiedName: (bizNode === null || bizNode === void 0 ? void 0 : bizNode.attrs.verified_name) || undefined,
            category: (bizNode === null || bizNode === void 0 ? void 0 : bizNode.attrs.biz_cat) || undefined
        };
    };
    /**
     * Pin a message in a chat
     * @param jid the chat JID
     * @param msgKey the message key to pin
     * @param duration 0 = unpin, 86400 = 24h, 604800 = 7d, 2592000 = 30d
     */
    const pinMessage = async (jid, msgKey, duration = 86400) => {
        await sendNode({
            tag: 'message',
            attrs: {
                to: jid,
                type: 'action',
                id: (0, Utils_1.generateMessageID)()
            },
            content: [{
                tag: 'pin_in_chat',
                attrs: {
                    type: duration === 0 ? 'unpin' : 'pin',
                    v: '1',
                    ...(duration > 0 ? { expiration: (Math.floor(Date.now() / 1000) + duration).toString() } : {})
                },
                content: [{
                    tag: 'key',
                    attrs: {},
                    content: [{
                        tag: 'remoteJid', attrs: {}, content: msgKey.remoteJid
                    }, {
                        tag: 'fromMe', attrs: {}, content: msgKey.fromMe ? 'true' : 'false'
                    }, {
                        tag: 'id', attrs: {}, content: msgKey.id
                    }]
                }]
            }]
        });
    };
    /**
     * Keep (bookmark/star) a message
     * @param jid the chat JID
     * @param msgKey the message key to keep
     * @param keep true = keep, false = remove
     */
    const keepMessage = async (jid, msgKey, keep = true) => {
        const label = keep ? 'add' : 'remove';
        await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'starred',
                id: generateMessageTag()
            },
            content: [{
                tag: 'star',
                attrs: { jid, type: label, index: '0' },
                content: [{
                    tag: 'message',
                    attrs: {
                        from: msgKey.remoteJid,
                        id: msgKey.id,
                        ...(msgKey.participant ? { participant: msgKey.participant } : {}),
                        type: msgKey.fromMe ? 'true' : 'false'
                    }
                }]
            }]
        });
    };
    /**
     * Set disappearing messages timer for a specific chat
     * @param jid the chat JID
     * @param timer 0 = off, 86400 = 24h, 604800 = 7d, 7776000 = 90d
     */
    const setDisappearingMessages = async (jid, timer) => {
        if ((0, WABinary_1.isJidGroup)(jid)) {
            await query({
                tag: 'iq',
                attrs: { to: jid, type: 'set', xmlns: 'w:g2' },
                content: [timer
                    ? { tag: 'ephemeral', attrs: { expiration: timer.toString() } }
                    : { tag: 'not_ephemeral', attrs: {} }
                ]
            });
        } else {
            await sendNode({
                tag: 'chatstate',
                attrs: { from: authState.creds.me.id, to: jid },
                content: [{
                    tag: timer ? 'timer' : 'not_timer',
                    attrs: timer ? { expiration: timer.toString() } : {}
                }]
            });
        }
    };
    /**
     * Check health of current WA session
     * Returns status, prekey count, whether creds are fresh
     */
    const sessionHealth = async () => {
        const creds = authState.creds;
        const hasMe = !!(creds === null || creds === void 0 ? void 0 : creds.me);
        const hasKeys = !!(creds === null || creds === void 0 ? void 0 : creds.signedPreKey);
        const hasAdvSecret = !!(creds === null || creds === void 0 ? void 0 : creds.advSecretKey);
        const lastSync = (creds === null || creds === void 0 ? void 0 : creds.lastAccountSyncTimestamp)
            ? new Date((creds.lastAccountSyncTimestamp) * 1000)
            : null;
        const syncAgeMs = lastSync ? (Date.now() - lastSync.getTime()) : null;
        return {
            ok: hasMe && hasKeys && hasAdvSecret,
            hasMe,
            hasKeys,
            hasAdvSecret,
            myJid: (creds === null || creds === void 0 ? void 0 : creds.me) ? creds.me.id : null,
            lastSync,
            syncAgeHours: syncAgeMs != null ? Math.round(syncAgeMs / 3600000) : null,
            platform: (creds === null || creds === void 0 ? void 0 : creds.platform) || null,
            pairingCode: (creds === null || creds === void 0 ? void 0 : creds.pairingCode) || null
        };
    };
    /** update the profile picture for yourself or a group */
    const updateProfilePicture = async (jid, content) => {
        let targetJid;
        if (!jid) {
            throw new boom_1.Boom('Illegal no-jid profile update. Please specify either your ID or the ID of the chat you wish to update');
        }
        if ((0, WABinary_1.jidNormalizedUser)(jid) !== (0, WABinary_1.jidNormalizedUser)(authState.creds.me.id)) {
            targetJid = (0, WABinary_1.jidNormalizedUser)(jid); // in case it is someone other than us
        }
        const { img } = await (0, Utils_1.generateProfilePicture)(content);
        await query({
            tag: 'iq',
            attrs: {
                target: targetJid,
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'w:profile:picture'
            },
            content: [
                {
                    tag: 'picture',
                    attrs: { type: 'image' },
                    content: img
                }
            ]
        });
    };
    /** remove the profile picture for yourself or a group */
    const removeProfilePicture = async (jid) => {
        let targetJid;
        if (!jid) {
            throw new boom_1.Boom('Illegal no-jid profile update. Please specify either your ID or the ID of the chat you wish to update');
        }
        if ((0, WABinary_1.jidNormalizedUser)(jid) !== (0, WABinary_1.jidNormalizedUser)(authState.creds.me.id)) {
            targetJid = (0, WABinary_1.jidNormalizedUser)(jid); // in case it is someone other than us
        }
        await query({
            tag: 'iq',
            attrs: {
                target: targetJid,
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'w:profile:picture'
            }
        });
    };
    /** update the profile status for yourself */
    const updateProfileStatus = async (status) => {
        await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'status'
            },
            content: [
                {
                    tag: 'status',
                    attrs: {},
                    content: Buffer.from(status, 'utf-8')
                }
            ]
        });
    };
    const updateProfileName = async (name) => {
        await chatModify({ pushNameSetting: name }, '');
    };
    const fetchBlocklist = async () => {
        const result = await query({
            tag: 'iq',
            attrs: {
                xmlns: 'blocklist',
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'get'
            }
        });
        const listNode = (0, WABinary_1.getBinaryNodeChild)(result, 'list');
        return (0, WABinary_1.getBinaryNodeChildren)(listNode, 'item')
            .map(n => n.attrs.jid);
    };
    const updateBlockStatus = async (jid, action) => {
        await query({
            tag: 'iq',
            attrs: {
                xmlns: 'blocklist',
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set'
            },
            content: [
                {
                    tag: 'item',
                    attrs: {
                        action,
                        jid
                    }
                }
            ]
        });
    };
    const getBusinessProfile = async (jid) => {
        var _a, _b, _c, _d, _e, _f, _g;
        const results = await query({
            tag: 'iq',
            attrs: {
                to: 's.whatsapp.net',
                xmlns: 'w:biz',
                type: 'get'
            },
            content: [{
                    tag: 'business_profile',
                    attrs: { v: '244' },
                    content: [{
                            tag: 'profile',
                            attrs: { jid }
                        }]
                }]
        });
        const profileNode = (0, WABinary_1.getBinaryNodeChild)(results, 'business_profile');
        const profiles = (0, WABinary_1.getBinaryNodeChild)(profileNode, 'profile');
        if (profiles) {
            const address = (0, WABinary_1.getBinaryNodeChild)(profiles, 'address');
            const description = (0, WABinary_1.getBinaryNodeChild)(profiles, 'description');
            const website = (0, WABinary_1.getBinaryNodeChild)(profiles, 'website');
            const email = (0, WABinary_1.getBinaryNodeChild)(profiles, 'email');
            const category = (0, WABinary_1.getBinaryNodeChild)((0, WABinary_1.getBinaryNodeChild)(profiles, 'categories'), 'category');
            const businessHours = (0, WABinary_1.getBinaryNodeChild)(profiles, 'business_hours');
            const businessHoursConfig = businessHours ?
                (0, WABinary_1.getBinaryNodeChildren)(businessHours, 'business_hours_config') :
                undefined;
            const websiteStr = (_a = website === null || website === void 0 ? void 0 : website.content) === null || _a === void 0 ? void 0 : _a.toString();
            return {
                wid: (_b = profiles.attrs) === null || _b === void 0 ? void 0 : _b.jid,
                address: (_c = address === null || address === void 0 ? void 0 : address.content) === null || _c === void 0 ? void 0 : _c.toString(),
                description: ((_d = description === null || description === void 0 ? void 0 : description.content) === null || _d === void 0 ? void 0 : _d.toString()) || '',
                website: websiteStr ? [websiteStr] : [],
                email: (_e = email === null || email === void 0 ? void 0 : email.content) === null || _e === void 0 ? void 0 : _e.toString(),
                category: (_f = category === null || category === void 0 ? void 0 : category.content) === null || _f === void 0 ? void 0 : _f.toString(),
                'business_hours': {
                    timezone: (_g = businessHours === null || businessHours === void 0 ? void 0 : businessHours.attrs) === null || _g === void 0 ? void 0 : _g.timezone,
                    'business_config': businessHoursConfig === null || businessHoursConfig === void 0 ? void 0 : businessHoursConfig.map(({ attrs }) => attrs)
                }
            };
        }
    };
    const cleanDirtyBits = async (type, fromTimestamp) => {
        logger.info({ fromTimestamp }, 'clean dirty bits ' + type);
        await sendNode({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'urn:xmpp:whatsapp:dirty',
                id: generateMessageTag(),
            },
            content: [
                {
                    tag: 'clean',
                    attrs: {
                        type,
                        ...(fromTimestamp ? { timestamp: fromTimestamp.toString() } : null),
                    }
                }
            ]
        });
    };
    const newAppStateChunkHandler = (isInitialSync) => {
        return {
            onMutation(mutation) {
                (0, Utils_1.processSyncAction)(mutation, ev, authState.creds.me, isInitialSync ? { accountSettings: authState.creds.accountSettings } : undefined, logger);
            }
        };
    };
    const resyncAppState = ev.createBufferedFunction(async (collections, isInitialSync) => {
        // we use this to determine which events to fire
        // otherwise when we resync from scratch -- all notifications will fire
        const initialVersionMap = {};
        const globalMutationMap = {};
        await authState.keys.transaction(async () => {
            var _a;
            const collectionsToHandle = new Set(collections);
            // in case something goes wrong -- ensure we don't enter a loop that cannot be exited from
            const attemptsMap = {};
            // keep executing till all collections are done
            // sometimes a single patch request will not return all the patches (God knows why)
            // so we fetch till they're all done (this is determined by the "has_more_patches" flag)
            while (collectionsToHandle.size) {
                const states = {};
                const nodes = [];
                for (const name of collectionsToHandle) {
                    const result = await authState.keys.get('app-state-sync-version', [name]);
                    let state = result[name];
                    if (state) {
                        if (typeof initialVersionMap[name] === 'undefined') {
                            initialVersionMap[name] = state.version;
                        }
                    }
                    else {
                        state = (0, Utils_1.newLTHashState)();
                    }
                    states[name] = state;
                    logger.info(`resyncing ${name} from v${state.version}`);
                    nodes.push({
                        tag: 'collection',
                        attrs: {
                            name,
                            version: state.version.toString(),
                            // return snapshot if being synced from scratch
                            'return_snapshot': (!state.version).toString()
                        }
                    });
                }
                const result = await query({
                    tag: 'iq',
                    attrs: {
                        to: WABinary_1.S_WHATSAPP_NET,
                        xmlns: 'w:sync:app:state',
                        type: 'set'
                    },
                    content: [
                        {
                            tag: 'sync',
                            attrs: {},
                            content: nodes
                        }
                    ]
                });
                // extract from binary node
                const decoded = await (0, Utils_1.extractSyncdPatches)(result, config === null || config === void 0 ? void 0 : config.options);
                for (const key in decoded) {
                    const name = key;
                    const { patches, hasMorePatches, snapshot } = decoded[name];
                    try {
                        if (snapshot) {
                            const { state: newState, mutationMap } = await (0, Utils_1.decodeSyncdSnapshot)(name, snapshot, getAppStateSyncKey, initialVersionMap[name], appStateMacVerification.snapshot);
                            states[name] = newState;
                            Object.assign(globalMutationMap, mutationMap);
                            logger.info(`restored state of ${name} from snapshot to v${newState.version} with mutations`);
                            await authState.keys.set({ 'app-state-sync-version': {
                                    [name]: newState
                                } });
                        }
                        // only process if there are syncd patches
                        if (patches.length) {
                            const { state: newState, mutationMap } = await (0, Utils_1.decodePatches)(name, patches, states[name], getAppStateSyncKey, config.options, initialVersionMap[name], logger, appStateMacVerification.patch);
                            await authState.keys.set({ 'app-state-sync-version': {
                                    [name]: newState
                                } });
                            logger.info(`synced ${name} to v${newState.version}`);
                            initialVersionMap[name] = newState.version;
                            Object.assign(globalMutationMap, mutationMap);
                        }
                        if (hasMorePatches) {
                            logger.info(`${name} has more patches...`);
                        }
                        else { // collection is done with sync
                            collectionsToHandle.delete(name);
                        }
                    }
                    catch (error) {
                        // if retry attempts overshoot
                        // or key not found
                        const isIrrecoverableError = attemptsMap[name] >= MAX_SYNC_ATTEMPTS ||
                            ((_a = error.output) === null || _a === void 0 ? void 0 : _a.statusCode) === 404 ||
                            error.name === 'TypeError';
                        logger.info({ name, error: error.stack }, `failed to sync state from version${isIrrecoverableError ? '' : ', removing and trying from scratch'}`);
                        await authState.keys.set({ 'app-state-sync-version': {
                                [name]: null
                            } });
                        // increment number of retries
                        attemptsMap[name] = (attemptsMap[name] || 0) + 1;
                        if (isIrrecoverableError) {
                            // stop retrying
                            collectionsToHandle.delete(name);
                        }
                    }
                }
            }
        });
        const { onMutation } = newAppStateChunkHandler(isInitialSync);
        for (const key in globalMutationMap) {
            onMutation(globalMutationMap[key]);
        }
    });
    /**
     * fetch the profile picture of a user/group
     * type = "preview" for a low res picture
     * type = "image for the high res picture"
     */
    const profilePictureUrl = async (jid, type = 'preview', timeoutMs) => {
        var _a;
        jid = (0, WABinary_1.jidNormalizedUser)(jid);
        const result = await query({
            tag: 'iq',
            attrs: {
                target: jid,
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'get',
                xmlns: 'w:profile:picture'
            },
            content: [
                { tag: 'picture', attrs: { type, query: 'url' } }
            ]
        }, timeoutMs);
        const child = (0, WABinary_1.getBinaryNodeChild)(result, 'picture');
        return (_a = child === null || child === void 0 ? void 0 : child.attrs) === null || _a === void 0 ? void 0 : _a.url;
    };
    const sendPresenceUpdate = async (type, toJid) => {
        const me = authState.creds.me;
        if (type === 'available' || type === 'unavailable') {
            if (!me.name) {
                logger.warn('no name present, ignoring presence update request...');
                return;
            }
            ev.emit('connection.update', { isOnline: type === 'available' });
            await sendNode({
                tag: 'presence',
                attrs: {
                    name: me.name,
                    type
                }
            });
        }
        else {
            await sendNode({
                tag: 'chatstate',
                attrs: {
                    from: me.id,
                    to: toJid,
                },
                content: [
                    {
                        tag: type === 'recording' ? 'composing' : type,
                        attrs: type === 'recording' ? { media: 'audio' } : {}
                    }
                ]
            });
        }
    };
    /**
     * @param toJid the jid to subscribe to
     * @param tcToken token for subscription, use if present
     */
    const presenceSubscribe = (toJid, tcToken) => (sendNode({
        tag: 'presence',
        attrs: {
            to: toJid,
            id: generateMessageTag(),
            type: 'subscribe'
        },
        content: tcToken ?
            [
                {
                    tag: 'tctoken',
                    attrs: {},
                    content: tcToken
                }
            ] :
            undefined
    }));
    const handlePresenceUpdate = ({ tag, attrs, content }) => {
        var _a;
        let presence;
        const jid = attrs.from;
        const participant = attrs.participant || attrs.from;
        if (shouldIgnoreJid(jid) && jid !== '@s.whatsapp.net') {
            return;
        }
        if (tag === 'presence') {
            presence = {
                lastKnownPresence: attrs.type === 'unavailable' ? 'unavailable' : 'available',
                lastSeen: attrs.last && attrs.last !== 'deny' ? +attrs.last : undefined
            };
        }
        else if (Array.isArray(content)) {
            const [firstChild] = content;
            let type = firstChild.tag;
            if (type === 'paused') {
                type = 'available';
            }
            if (((_a = firstChild.attrs) === null || _a === void 0 ? void 0 : _a.media) === 'audio') {
                type = 'recording';
            }
            presence = { lastKnownPresence: type };
        }
        else {
            logger.error({ tag, attrs, content }, 'recv invalid presence node');
        }
        if (presence) {
            ev.emit('presence.update', { id: jid, presences: {
                    [participant]: presence
                } });
        }
    };
    const appPatch = async (patchCreate) => {
        const name = patchCreate.type;
        const myAppStateKeyId = authState.creds.myAppStateKeyId;
        if (!myAppStateKeyId) {
            throw new boom_1.Boom('App state key not present!', { statusCode: 400 });
        }
        let initial;
        let encodeResult;
        await processingMutex.mutex(async () => {
            await authState.keys.transaction(async () => {
                logger.debug({ patch: patchCreate }, 'applying app patch');
                await resyncAppState([name], false);
                const { [name]: currentSyncVersion } = await authState.keys.get('app-state-sync-version', [name]);
                initial = currentSyncVersion || (0, Utils_1.newLTHashState)();
                encodeResult = await (0, Utils_1.encodeSyncdPatch)(patchCreate, myAppStateKeyId, initial, getAppStateSyncKey);
                const { patch, state } = encodeResult;
                const node = {
                    tag: 'iq',
                    attrs: {
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: 'set',
                        xmlns: 'w:sync:app:state'
                    },
                    content: [
                        {
                            tag: 'sync',
                            attrs: {},
                            content: [
                                {
                                    tag: 'collection',
                                    attrs: {
                                        name,
                                        version: (state.version - 1).toString(),
                                        'return_snapshot': 'false'
                                    },
                                    content: [
                                        {
                                            tag: 'patch',
                                            attrs: {},
                                            content: WAProto_1.proto.SyncdPatch.encode(patch).finish()
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                };
                await query(node);
                await authState.keys.set({ 'app-state-sync-version': {
                        [name]: state
                    } });
            });
        });
        if (config.emitOwnEvents) {
            const { onMutation } = newAppStateChunkHandler(false);
            const { mutationMap } = await (0, Utils_1.decodePatches)(name, [{ ...encodeResult.patch, version: { version: encodeResult.state.version }, }], initial, getAppStateSyncKey, config.options, undefined, logger);
            for (const key in mutationMap) {
                onMutation(mutationMap[key]);
            }
        }
    };
    /** sending non-abt props may fix QR scan fail if server expects */
    const fetchProps = async () => {
        var _a, _b;
        const resultNode = await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                xmlns: 'w',
                type: 'get',
            },
            content: [
                {
                    tag: 'props',
                    attrs: {
                        protocol: '2',
                        hash: ((_a = authState === null || authState === void 0 ? void 0 : authState.creds) === null || _a === void 0 ? void 0 : _a.lastPropHash) || ''
                    }
                }
            ]
        });
        const propsNode = (0, WABinary_1.getBinaryNodeChild)(resultNode, 'props');
        let props = {};
        if (propsNode) {
            authState.creds.lastPropHash = (_b = propsNode === null || propsNode === void 0 ? void 0 : propsNode.attrs) === null || _b === void 0 ? void 0 : _b.hash;
            ev.emit('creds.update', authState.creds);
            props = (0, WABinary_1.reduceBinaryNodeToDictionary)(propsNode, 'prop');
        }
        logger.debug('fetched props');
        return props;
    };
    /**
     * modify a chat -- mark unread, read etc.
     * lastMessages must be sorted in reverse chronologically
     * requires the last messages till the last message received; required for archive & unread
     */
    const chatModify = (mod, jid) => {
        const patch = (0, Utils_1.chatModificationToAppPatch)(mod, jid);
        return appPatch(patch);
    };
    /**
     * Star or Unstar a message
     */
    const star = (jid, messages, star) => {
        return chatModify({
            star: {
                messages,
                star
            }
        }, jid);
    };
    /**
     * Adds label for the chats
     */
    const addChatLabel = (jid, labelId) => {
        return chatModify({
            addChatLabel: {
                labelId
            }
        }, jid);
    };
    /**
     * Removes label for the chat
     */
    const removeChatLabel = (jid, labelId) => {
        return chatModify({
            removeChatLabel: {
                labelId
            }
        }, jid);
    };
    /**
     * Adds label for the message
     */
    const addMessageLabel = (jid, messageId, labelId) => {
        return chatModify({
            addMessageLabel: {
                messageId,
                labelId
            }
        }, jid);
    };
    /**
     * Removes label for the message
     */
    const removeMessageLabel = (jid, messageId, labelId) => {
        return chatModify({
            removeMessageLabel: {
                messageId,
                labelId
            }
        }, jid);
    };
    /**
     * queries need to be fired on connection open
     * help ensure parity with WA Web
     * */
    const executeInitQueries = async () => {
        await Promise.all([
            fetchProps(),
            fetchBlocklist(),
            fetchPrivacySettings(),
        ]);
    };
    const upsertMessage = ev.createBufferedFunction(async (msg, type) => {
        var _a, _b, _c;
        ev.emit('messages.upsert', { messages: [msg], type });
        if (!!msg.pushName) {
            let jid = msg.key.fromMe ? authState.creds.me.id : (msg.key.participant || msg.key.remoteJid);
            jid = (0, WABinary_1.jidNormalizedUser)(jid);
            if (!msg.key.fromMe) {
                ev.emit('contacts.update', [{ id: jid, notify: msg.pushName, verifiedName: msg.verifiedBizName }]);
            }
            // update our pushname too
            if (msg.key.fromMe && msg.pushName && ((_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.name) !== msg.pushName) {
                ev.emit('creds.update', { me: { ...authState.creds.me, name: msg.pushName } });
            }
        }
        const historyMsg = (0, Utils_1.getHistoryMsg)(msg.message);
        const shouldProcessHistoryMsg = historyMsg ?
            (shouldSyncHistoryMessage(historyMsg) &&
                Defaults_1.PROCESSABLE_HISTORY_TYPES.includes(historyMsg.syncType)) :
            false;
        if (historyMsg && !authState.creds.myAppStateKeyId) {
            logger.warn('skipping app state sync, as myAppStateKeyId is not set');
            pendingAppStateSync = true;
        }
        await Promise.all([
            (async () => {
                if (historyMsg &&
                    authState.creds.myAppStateKeyId) {
                    pendingAppStateSync = false;
                    await doAppStateSync();
                }
            })(),
            (0, process_message_1.default)(msg, {
                shouldProcessHistoryMsg,
                ev,
                creds: authState.creds,
                keyStore: authState.keys,
                logger,
                options: config.options,
                getMessage: config.getMessage,
            })
        ]);
        if (((_c = (_b = msg.message) === null || _b === void 0 ? void 0 : _b.protocolMessage) === null || _c === void 0 ? void 0 : _c.appStateSyncKeyShare) &&
            pendingAppStateSync) {
            await doAppStateSync();
            pendingAppStateSync = false;
        }
        async function doAppStateSync() {
            if (!authState.creds.accountSyncCounter) {
                logger.info('doing initial app state sync');
                await resyncAppState(Types_1.ALL_WA_PATCH_NAMES, true);
                const accountSyncCounter = (authState.creds.accountSyncCounter || 0) + 1;
                ev.emit('creds.update', { accountSyncCounter });
                if (needToFlushWithAppStateSync) {
                    logger.debug('flushing with app state sync');
                    ev.flush();
                }
            }
        }
    });
    ws.on('CB:presence', handlePresenceUpdate);
    ws.on('CB:chatstate', handlePresenceUpdate);
    ws.on('CB:ib,,dirty', async (node) => {
        const { attrs } = (0, WABinary_1.getBinaryNodeChild)(node, 'dirty');
        const type = attrs.type;
        switch (type) {
            case 'account_sync':
                if (attrs.timestamp) {
                    let { lastAccountSyncTimestamp } = authState.creds;
                    if (lastAccountSyncTimestamp) {
                        await cleanDirtyBits('account_sync', lastAccountSyncTimestamp);
                    }
                    lastAccountSyncTimestamp = +attrs.timestamp;
                    ev.emit('creds.update', { lastAccountSyncTimestamp });
                }
                break;
            case 'groups':
                // handled in groups.ts
                break;
            default:
                logger.info({ node }, 'received unknown sync');
                break;
        }
    });
    ev.on('connection.update', ({ connection, receivedPendingNotifications }) => {
        var _a;
        if (connection === 'open') {
            if (fireInitQueries) {
                executeInitQueries()
                    .catch(error => onUnexpectedError(error, 'init queries'));
            }
            sendPresenceUpdate(markOnlineOnConnect ? 'available' : 'unavailable')
                .catch(error => onUnexpectedError(error, 'presence update requests'));
        }
        if (receivedPendingNotifications) {
            // if we don't have the app state key
            // we keep buffering events until we finally have
            // the key and can sync the messages
            if (!((_a = authState.creds) === null || _a === void 0 ? void 0 : _a.myAppStateKeyId) && !config.mobile) {
                ev.buffer();
                needToFlushWithAppStateSync = true;
            }
        }
    });
    return {
        ...sock,
        processingMutex,
        fetchPrivacySettings,
        upsertMessage,
        appPatch,
        sendPresenceUpdate,
        presenceSubscribe,
        profilePictureUrl,
        onWhatsApp,
        fetchBlocklist,
        fetchStatus,
        fetchBio,
        sendStatusReaction,
        sendStatusLike,
        sendStatusView,
        isRegisteredWA,
        fetchCommonGroups,
        fetchContactBadge,
        pinMessage,
        keepMessage,
        setDisappearingMessages,
        sessionHealth,
        updateProfilePicture,
        removeProfilePicture,
        updateProfileStatus,
        updateProfileName,
        updateBlockStatus,
        updateLastSeenPrivacy,
        updateOnlinePrivacy,
        updateProfilePicturePrivacy,
        updateStatusPrivacy,
        updateReadReceiptsPrivacy,
        updateGroupsAddPrivacy,
        updateDefaultDisappearingMode,
        getBusinessProfile,
        resyncAppState,
        chatModify,
        cleanDirtyBits,
        addChatLabel,
        removeChatLabel,
        addMessageLabel,
        removeMessageLabel,
        star,

        /**
         * Search messages across all chats or within a specific chat.
         * @param query    keyword to search
         * @param jid      optional — limit to a specific chat JID
         * @param count    max results to return (default 25)
         * @param page     pagination page (0-based, default 0)
         */
        searchMessages: async (query, jid, count = 25, page = 0) => {
            if (!query || !query.trim()) return [];
            const searchAttrs = {
                query: query.trim(),
                count: String(count),
                page: String(page),
                ...(jid ? { jid } : {})
            };
            let result;
            try {
                result = await sock.query({
                    tag: 'iq',
                    attrs: {
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: 'get',
                        xmlns: 'urn:xmpp:whatsapp:search'
                    },
                    content: [{
                        tag: 'search',
                        attrs: searchAttrs,
                        content: undefined
                    }]
                });
            } catch {
                return [];
            }
            const searchNode = (0, WABinary_1.getBinaryNodeChild)(result, 'search');
            if (!searchNode) return [];
            const msgs = (0, WABinary_1.getBinaryNodeChildren)(searchNode, 'message');
            return msgs.map(n => ({
                key: {
                    remoteJid: n.attrs.jid,
                    id: n.attrs.id,
                    fromMe: n.attrs.from_me === 'true'
                },
                snippet: (0, WABinary_1.getBinaryNodeChildString)(n, 'text') || '',
                timestamp: n.attrs.t ? +n.attrs.t : undefined
            }));
        },

        /**
         * Search contacts (registered on WhatsApp) by name or number.
         * @param query   name fragment or phone number prefix
         * @param count   max results (default 20)
         */
        searchContacts: async (query, count = 20) => {
            if (!query || !query.trim()) return [];
            let result;
            try {
                result = await sock.query({
                    tag: 'iq',
                    attrs: {
                        to: WABinary_1.S_WHATSAPP_NET,
                        type: 'get',
                        xmlns: 'usync'
                    },
                    content: [{
                        tag: 'usync',
                        attrs: { sid: sock.generateMessageTag(), mode: 'query', last: 'true', index: '0', context: 'contact_search' },
                        content: [{
                            tag: 'query',
                            attrs: {},
                            content: [{
                                tag: 'contact',
                                attrs: {},
                                content: undefined
                            }]
                        }, {
                            tag: 'list',
                            attrs: {},
                            content: [{
                                tag: 'user',
                                attrs: {},
                                content: [{
                                    tag: 'search',
                                    attrs: { query: query.trim(), count: String(count) },
                                    content: undefined
                                }]
                            }]
                        }]
                    }]
                });
            } catch {
                return [];
            }
            const usyncNode = (0, WABinary_1.getBinaryNodeChild)(result, 'usync');
            const listNode = usyncNode ? (0, WABinary_1.getBinaryNodeChild)(usyncNode, 'list') : null;
            if (!listNode) return [];
            return (0, WABinary_1.getBinaryNodeChildren)(listNode, 'user').map(u => ({
                jid: u.attrs.jid,
                name: (0, WABinary_1.getBinaryNodeChildString)(u, 'name') || undefined,
                phone: u.attrs.jid?.split('@')[0]
            }));
        }
    };
};
exports.makeChatsSocket = makeChatsSocket;
