/**
 * Profile Features — Type Declarations
 */

export interface NormalizedProfile {
    jid: string | null;
    name: string | null;
    about: string | null;
    profilePicUrl: string | null;
    isBusiness: boolean;
    business: {
        verifiedName: string | null;
        category: string | null;
        description: string | null;
        email: string | null;
        website: string[];
        address: string | null;
    } | null;
    lastSeen: number | null;
    updatedAt: number;
}

export interface ProfilePicChangeResult {
    changed: boolean;
    oldUrl: string | null;
    newUrl: string | null;
}

export interface Watcher {
    stop: () => void;
}

export declare function isBusinessProfile(profile: any): boolean;
export declare function normalizeProfileMetadata(raw: any): NormalizedProfile | null;
export declare function makeProfileSocket(sock: any): any;
