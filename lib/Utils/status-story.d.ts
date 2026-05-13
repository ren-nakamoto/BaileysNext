/**
 * Status & Story Features — Type Declarations
 */

export declare const STATUS_JID: 'status@broadcast';

export interface StoryViewer {
    jid: string;
    timestamp: number;
}

export interface StoryMetadata {
    type: 'image' | 'video' | 'text';
    caption: string;
    url: string | null;
    duration: number | null;
    mimetype: string | null;
    viewOnce: boolean;
    isForwarded: boolean;
    timestamp: number | null;
}

export interface SendStatusOptions {
    caption?: string;
    backgroundColor?: string;
    font?: number;
    statusJidList?: string[];
    viewOnce?: boolean;
}

export declare function parseStoryViewers(node: any): StoryViewer[];
export declare function parseStoryMetadata(message: any): StoryMetadata | null;
export declare function buildStatusReactionNode(statusMessageKey: any, emoji: string, fromJid: string): any;
export declare function buildStoryReactionNode(storyKey: any, emoji: string, senderJid: string): any;
export declare function makeStatusSocket(sock: any): any;
