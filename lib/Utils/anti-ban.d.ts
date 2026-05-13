/**
 * Anti-Ban System for Baileys — Type Declarations
 */

export interface AdaptivePacerOptions {
    windowMs?: number;
    burstLimit?: number;
    slowdownMs?: number;
}

export interface PresenceThrottleOptions {
    minIntervalMs?: number;
    maxTypingMs?: number;
}

export interface AntiBurstLimiterOptions {
    tokensPerSecond?: number;
    maxBurst?: number;
}

export interface AntiBanOptions extends AdaptivePacerOptions, PresenceThrottleOptions, AntiBurstLimiterOptions {
    reconnectBaseMs?: number;
    reconnectMaxMs?: number;
    reconnectJitterMs?: number;
    maxRetries?: number;
    retryBaseMs?: number;
    minPresenceIntervalMs?: number;
}

export declare class AdaptivePacer {
    constructor(opts?: AdaptivePacerOptions);
    pace(): Promise<void>;
    isBursting(): boolean;
    reset(): void;
}

export declare class PresenceThrottle {
    constructor(opts?: PresenceThrottleOptions);
    shouldSendPresence(): boolean;
    simulateTyping(
        sendPresence: (jid: string, type: 'composing' | 'paused') => Promise<void>,
        jid: string,
        durationMs?: number
    ): Promise<void>;
    clear(): void;
}

export declare class AntiBurstLimiter {
    constructor(opts?: AntiBurstLimiterOptions);
    acquire(): Promise<void>;
    available(): number;
}

export declare function randomInterval(baseMs?: number, jitterMs?: number): number;
export declare function safeReconnectDelay(attempt: number, baseMs?: number, maxMs?: number, jitterMs?: number): number;
export declare function safeRetry<T>(
    fn: () => Promise<T>,
    maxRetries?: number,
    baseDelayMs?: number,
    onRetry?: (attempt: number, error: Error) => void
): Promise<T>;

export interface AntiBanBundle {
    pacer: AdaptivePacer;
    burst: AntiBurstLimiter;
    presence: PresenceThrottle;
    reconnectDelay: (attempt: number) => number;
    retry: <T>(fn: () => Promise<T>, retries?: number, onRetry?: (attempt: number, error: Error) => void) => Promise<T>;
    randomInterval: (base?: number, jitter?: number) => number;
}

export declare function createAntiBan(opts?: AntiBanOptions): AntiBanBundle;
export declare const AntiBan: AntiBanBundle;
