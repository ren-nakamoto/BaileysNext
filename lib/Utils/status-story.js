"use strict";
/**
 * Status & Story Features for Baileys
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements: status reactions, story reaction events, story metadata,
 * story viewers, and improved status sending helpers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeStatusSocket =
exports.buildStoryReactionNode =
exports.buildStatusReactionNode =
exports.parseStoryMetadata =
exports.parseStoryViewers =
exports.STATUS_JID =
void 0;

const WABinary_1 = require("../WABinary");

exports.STATUS_JID = 'status@broadcast';

// ── Story / Status Parsers ────────────────────────────────────────────────────

/**
 * Parse story viewer list from a WA binary node.
 * WA sends viewer receipts as receipt nodes tagged to 'status@broadcast'.
 *
 * @param node  Binary node received from WA
 * @returns     Array of viewer JIDs with timestamps
 */
const parseStoryViewers = (node) => {
    const viewers = [];
    if (!node || !node.content) return viewers;
    const content = Array.isArray(node.content) ? node.content : [];
    for (const child of content) {
        if (child.tag === 'receipt' || child.tag === 'read') {
            const jid = child.attrs?.from || child.attrs?.participant;
            const ts = child.attrs?.t ? parseInt(child.attrs.t, 10) : Math.floor(Date.now() / 1000);
            if (jid) viewers.push({ jid, timestamp: ts });
        }
    }
    return viewers;
};
exports.parseStoryViewers = parseStoryViewers;

/**
 * Parse story metadata from a message or node.
 * Extracts caption, duration, media type, and privacy.
 *
 * @param message  Proto message object or node
 */
const parseStoryMetadata = (message) => {
    if (!message) return null;
    const img = message.imageMessage;
    const vid = message.videoMessage;
    const txt = message.extendedTextMessage;
    const content = img || vid || txt;
    if (!content) return null;

    return {
        type: img ? 'image' : vid ? 'video' : 'text',
        caption: content.caption || '',
        url: content.url || null,
        duration: vid?.seconds || null,
        mimetype: content.mimetype || null,
        viewOnce: message.viewOnceMessage != null,
        isForwarded: content.contextInfo?.isForwarded || false,
        timestamp: message.messageTimestamp ? Number(message.messageTimestamp) : null,
    };
};
exports.parseStoryMetadata = parseStoryMetadata;

// ── Reaction Builders ─────────────────────────────────────────────────────────

/**
 * Build a WA binary node to react to a status update.
 *
 * @param statusMessageKey  Key of the status message to react to
 * @param emoji             Emoji reaction (e.g. "❤️")
 * @param fromJid           Sender JID
 */
const buildStatusReactionNode = (statusMessageKey, emoji, fromJid) => {
    return {
        tag: 'message',
        attrs: {
            to: exports.STATUS_JID,
            type: 'text',
        },
        content: [
            {
                tag: 'reaction',
                attrs: {
                    code: emoji,
                    'sender-timestamp-ms': Date.now().toString(),
                },
                content: [
                    {
                        tag: 'key',
                        attrs: {},
                        content: [
                            { tag: 'remoteJid', attrs: {}, content: Buffer.from(exports.STATUS_JID) },
                            { tag: 'fromMe', attrs: {}, content: Buffer.from('false') },
                            { tag: 'id', attrs: {}, content: Buffer.from(statusMessageKey.id || '') },
                            { tag: 'participant', attrs: {}, content: Buffer.from(statusMessageKey.participant || fromJid) },
                        ]
                    }
                ]
            }
        ]
    };
};
exports.buildStatusReactionNode = buildStatusReactionNode;

/**
 * Build a reaction node for a story (same broadcast JID, different semantics).
 * Includes story metadata fields required by WA servers.
 *
 * @param storyKey   Key of the story message
 * @param emoji      Reaction emoji
 * @param senderJid  JID of the reactor
 */
const buildStoryReactionNode = (storyKey, emoji, senderJid) => {
    const base = buildStatusReactionNode(storyKey, emoji, senderJid);
    // Attach story-specific attributes
    base.attrs['story'] = '1';
    base.attrs['participant'] = senderJid;
    return base;
};
exports.buildStoryReactionNode = buildStoryReactionNode;

// ── Status Socket Extension ───────────────────────────────────────────────────

/**
 * Wraps a Baileys socket and adds status/story utility methods.
 * Call `makeStatusSocket(sock)` after creating your socket.
 *
 * @example
 * const sock = makeWASocket(config);
 * const statusSock = makeStatusSocket(sock);
 * await statusSock.sendStatusReaction(statusKey, '❤️');
 */
const makeStatusSocket = (sock) => {
    /**
     * Send a reaction to a status/story.
     * Triggers a 'message' send to status@broadcast with the reaction node.
     */
    const sendStatusReaction = async (statusMessageKey, emoji) => {
        const { id: meId } = sock.authState.creds.me || {};
        if (!meId) throw new Error('Not authenticated — cannot send status reaction');

        const reactionMsg = {
            react: {
                key: {
                    remoteJid: exports.STATUS_JID,
                    id: statusMessageKey.id,
                    participant: statusMessageKey.participant,
                    fromMe: false,
                },
                text: emoji,
                senderTimestampMs: Date.now(),
            }
        };

        return sock.sendMessage(exports.STATUS_JID, { react: reactionMsg.react });
    };

    /**
     * Send an improved status update with metadata.
     * Handles privacy list and background color for text statuses.
     */
    const sendStatus = async (content, opts = {}) => {
        const {
            caption = '',
            backgroundColor = '#000000',
            font = 0,
            statusJidList = [],
            viewOnce = false,
        } = opts;

        let message;
        if (typeof content === 'string') {
            // Text status
            message = {
                extendedTextMessage: {
                    text: content,
                    backgroundArgb: parseInt(backgroundColor.replace('#', ''), 16),
                    font,
                    inviteLinkGroupType: 0,
                }
            };
        } else {
            // Media status — assume content is already a proto message object
            message = content;
            if (caption) {
                const key = Object.keys(message)[0];
                if (message[key]) message[key].caption = caption;
            }
        }

        if (viewOnce) {
            message = { viewOnceMessage: { message } };
        }

        return sock.sendMessage(exports.STATUS_JID, message, {
            statusJidList,
            backgroundColor,
        });
    };

    /**
     * Get viewers for a status you sent.
     * Requires that your store is tracking message receipts.
     * Returns viewer JIDs from the in-memory store if available.
     */
    const getStatusViewers = async (messageId) => {
        // If the socket has a store attached, query it
        if (sock.store && typeof sock.store.loadMessages === 'function') {
            const msgs = await sock.store.loadMessages(exports.STATUS_JID, 50);
            const msg = msgs?.find(m => m.key?.id === messageId);
            return msg?.userReceipt?.map(r => ({ jid: r.userJid, timestamp: r.readTimestamp || r.receiptTimestamp })) || [];
        }
        return [];
    };

    /**
     * Listen for incoming story reactions and emit them as events.
     * Attach after `sock.ev.on('messages.upsert', ...)`.
     *
     * @param onReaction  Callback(jid, emoji, storyKey)
     */
    const onStoryReaction = (onReaction) => {
        sock.ev.on('messages.upsert', ({ messages }) => {
            for (const msg of messages) {
                if (msg.key?.remoteJid !== exports.STATUS_JID) continue;
                const reaction = msg.message?.reactionMessage;
                if (!reaction) continue;
                onReaction(msg.key.participant || msg.key.remoteJid, reaction.text, reaction.key);
            }
        });
    };

    return {
        ...sock,
        sendStatusReaction,
        sendStatus,
        getStatusViewers,
        onStoryReaction,
    };
};
exports.makeStatusSocket = makeStatusSocket;
