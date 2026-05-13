import type { proto } from '../../WAProto';

type AnySocket = Record<string, any>;
export type ContactCardInput = {
    jid?: string;
    number?: string;
    name?: string;
    fullName?: string;
    organization?: string;
};
export declare const normalizeStoryParticipant: (keyOrMessage: any) => string | undefined;
export declare const patchModernSocket: <T extends AnySocket>(sock: T, options?: Record<string, any>) => T & {
    reactStatus(keyOrMessage: proto.IWebMessageInfo | proto.IMessageKey, emoji?: string, relayOptions?: Record<string, any>): Promise<any>;
    sendStatusReaction(keyOrMessage: proto.IWebMessageInfo | proto.IMessageKey, emoji?: string, relayOptions?: Record<string, any>): Promise<any>;
    readStatus(keyOrMessage: proto.IWebMessageInfo | proto.IMessageKey, relayOptions?: Record<string, any>): Promise<any>;
    sendPollMessage(jid: string, name: string, values: string[], selectableCount?: number, opts?: Record<string, any>): Promise<any>;
    editMessage(jid: string, key: proto.IMessageKey, text: string, opts?: Record<string, any>): Promise<any>;
    deleteMessage(jid: string, key: proto.IMessageKey, opts?: Record<string, any>): Promise<any>;
    pinMessage(jid: string, key: proto.IMessageKey, seconds?: number, opts?: Record<string, any>): Promise<any>;
    unpinMessage(jid: string, key: proto.IMessageKey, opts?: Record<string, any>): Promise<any>;
    sendContactCard(jid: string, contact: ContactCardInput, opts?: Record<string, any>): Promise<any>;
    sendContacts(jid: string, contacts: ContactCardInput[], opts?: Record<string, any>): Promise<any>;
    sendAlbumMessage(jid: string, mediaItems: Record<string, any>[], opts?: Record<string, any>): Promise<any[]>;
    archiveChat(jid: string, archive?: boolean): Promise<any>;
    muteChat(jid: string, muteEndTimestamp?: number): Promise<any>;
    unmuteChat(jid: string): Promise<any>;
    requestPairingCodeSafe(phoneNumber: string): Promise<string>;
    newsletterMetadataSafe(jidOrInvite: string): Promise<any>;
};
export default patchModernSocket;
