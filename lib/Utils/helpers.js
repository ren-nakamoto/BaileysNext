"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReplyMessage = exports.getMessageType = exports.downloadMedia = exports.parseMessageContent = void 0;
const path_1 = require("path");
const fs_1 = require("fs");
const messages_media_1 = require("./messages-media");

/**
 * Extract plain text or caption from any message type
 * Works with text, image, video, document, sticker, reaction, etc.
 * @param msg WAMessage object
 * @returns extracted string or empty string
 */
const parseMessageContent = (msg) => {
    if (!msg) return '';
    const m = msg.message || msg;
    if (!m) return '';

    // Unwrap common wrappers
    const inner =
        m.ephemeralMessage?.message ||
        m.viewOnceMessage?.message ||
        m.viewOnceMessageV2?.message?.viewOnceMessage?.message ||
        m.documentWithCaptionMessage?.message ||
        m.editedMessage?.message?.protocolMessage?.editedMessage ||
        m;

    return (
        inner.conversation ||
        inner.extendedTextMessage?.text ||
        inner.imageMessage?.caption ||
        inner.videoMessage?.caption ||
        inner.documentMessage?.caption ||
        inner.audioMessage?.caption ||
        inner.stickerMessage?.caption ||
        inner.templateMessage?.hydratedTemplate?.hydratedContentText ||
        inner.buttonsMessage?.contentText ||
        inner.listMessage?.description ||
        inner.reactionMessage?.text ||
        inner.pollCreationMessage?.name ||
        inner.pollCreationMessageV3?.name ||
        ''
    );
};
exports.parseMessageContent = parseMessageContent;

/**
 * Return a simple string type name for any message
 * @param msg WAMessage or message object
 * @returns e.g. 'text', 'image', 'video', 'sticker', 'audio', 'document', 'reaction', 'poll', 'unknown'
 */
const getMessageType = (msg) => {
    if (!msg) return 'unknown';
    const m = msg.message || msg;
    if (!m) return 'unknown';

    const inner =
        m.ephemeralMessage?.message ||
        m.viewOnceMessage?.message ||
        m.viewOnceMessageV2?.message?.viewOnceMessage?.message ||
        m.documentWithCaptionMessage?.message ||
        m;

    if (inner.conversation || inner.extendedTextMessage) return 'text';
    if (inner.imageMessage) return 'image';
    if (inner.videoMessage) return inner.videoMessage.gifPlayback ? 'gif' : 'video';
    if (inner.audioMessage) return inner.audioMessage.ptt ? 'ptt' : 'audio';
    if (inner.stickerMessage) return 'sticker';
    if (inner.documentMessage) return 'document';
    if (inner.contactMessage || inner.contactsArrayMessage) return 'contact';
    if (inner.locationMessage || inner.liveLocationMessage) return 'location';
    if (inner.reactionMessage) return 'reaction';
    if (inner.pollCreationMessage || inner.pollCreationMessageV3) return 'poll';
    if (inner.pollUpdateMessage) return 'pollVote';
    if (inner.buttonsMessage) return 'buttons';
    if (inner.listMessage) return 'list';
    if (inner.interactiveMessage) return 'interactive';
    if (inner.templateMessage) return 'template';
    if (inner.orderMessage) return 'order';
    if (inner.productMessage) return 'product';
    if (inner.protocolMessage) return 'protocol';
    if (inner.groupInviteMessage) return 'groupInvite';
    if (inner.callLogMessagesMessage) return 'callLog';
    return 'unknown';
};
exports.getMessageType = getMessageType;

/**
 * Download media from a WAMessage to a buffer or file path
 * @param msg WAMessage containing media
 * @param outputPath optional file path to save; if omitted returns Buffer
 * @returns Buffer or file path string
 */
const downloadMedia = async (msg) => {
    if (!msg) throw new Error('downloadMedia: msg is required');
    const m = msg.message || msg;

    const inner =
        m.ephemeralMessage?.message ||
        m.viewOnceMessage?.message ||
        m.viewOnceMessageV2?.message?.viewOnceMessage?.message ||
        m.documentWithCaptionMessage?.message ||
        m;

    const mediaTypes = [
        'imageMessage', 'videoMessage', 'audioMessage',
        'stickerMessage', 'documentMessage'
    ];
    const mediaType = mediaTypes.find(t => inner[t]);
    if (!mediaType) throw new Error('downloadMedia: no media found in message');

    const stream = await (0, messages_media_1.downloadContentFromMessage)(inner[mediaType], mediaType.replace('Message', ''));
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
};
exports.downloadMedia = downloadMedia;

/**
 * Build a reply message object for use with sendMessage options.quoted
 * @param quotedMsg the WAMessage to reply to
 * @param text reply text (optional shorthand)
 */
const buildReplyMessage = (quotedMsg, text) => {
    const base = { quoted: quotedMsg };
    if (text !== undefined) {
        return { content: { text }, options: base };
    }
    return base;
};
exports.buildReplyMessage = buildReplyMessage;
