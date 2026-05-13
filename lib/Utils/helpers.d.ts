import { WAMessage } from '../Types';

/** Extract plain text or caption from any message type */
export declare const parseMessageContent: (msg: WAMessage | any) => string;

/** Return a simple string type name for any message (e.g. 'text', 'image', 'video') */
export declare const getMessageType: (msg: WAMessage | any) => string;

/** Download media from a WAMessage to a Buffer */
export declare const downloadMedia: (msg: WAMessage | any) => Promise<Buffer>;

/** Build a reply message object for use with sendMessage options.quoted */
export declare const buildReplyMessage: (quotedMsg: WAMessage, text?: string) => any;
