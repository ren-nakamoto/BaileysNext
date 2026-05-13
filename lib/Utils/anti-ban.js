"use strict";
/**
 * Anti-Ban System for Baileys
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements randomized send intervals, adaptive pacing, typing/presence
 * throttling, anti-burst limiting, safer reconnect pacing, and retry handling.
 *
 * Drop-in utility — import and wrap your send calls.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AntiBan =
exports.createAntiBan =
exports.safeRetry =
exports.safeReconnectDelay =
exports.AntiBurstLimiter =
exports.PresenceThrottle =
exports.AdaptivePacer =
exports.randomInterval = void 0;

const crypto_1 = require("crypto");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Cryptographically-seeded random float in [min, max) */
const secureRandom = (min, max) => {
    const buf = crypto_1.randomBytes(4);
    const frac = buf.readUInt32BE(0) / 0xFFFFFFFF;
    return min + frac * (max - min);
};

/** Sleep for ms milliseconds */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Randomized Send Intervals ─────────────────────────────────────────────────

/**
 * Returns a randomized delay (ms) for message sending.
 * Simulates human typing rhythm — avoids machine-like regularity.
 *
 * @param baseMs   Base delay in ms (default 1200)
 * @param jitterMs Maximum random jitter added (default 800)
 */
const randomInterval = (baseMs = 1200, jitterMs = 800) => {
    return Math.floor(baseMs + secureRandom(0, jitterMs));
};
exports.randomInterval = randomInterval;

// ── Adaptive Pacer ────────────────────────────────────────────────────────────

/**
 * AdaptivePacer tracks message volume and slows down when approaching
 * suspicious send rates. The window and threshold are configurable.
 */
class AdaptivePacer {
    /**
     * @param opts.windowMs      Sliding window in ms (default 60_000 = 1 min)
     * @param opts.burstLimit    Messages allowed per window before throttling (default 20)
     * @param opts.slowdownMs    Extra delay added when throttled (default 3000)
     */
    constructor(opts = {}) {
        this.windowMs = opts.windowMs ?? 60_000;
        this.burstLimit = opts.burstLimit ?? 20;
        this.slowdownMs = opts.slowdownMs ?? 3000;
        this._timestamps = [];
    }

    /** Record a send event and return how long to wait before next send */
    async pace() {
        const now = Date.now();
        // Prune old timestamps outside window
        this._timestamps = this._timestamps.filter(t => now - t < this.windowMs);
        this._timestamps.push(now);

        const count = this._timestamps.length;
        if (count >= this.burstLimit) {
            // Exponential backoff when bursting
            const overCount = count - this.burstLimit + 1;
            const extra = this.slowdownMs * Math.min(overCount, 5);
            await sleep(extra);
        } else {
            // Normal randomized pacing
            await sleep(randomInterval(800, 600));
        }
    }

    /** Returns true if currently in burst-limited state */
    isBursting() {
        const now = Date.now();
        const recent = this._timestamps.filter(t => now - t < this.windowMs);
        return recent.length >= this.burstLimit;
    }

    reset() {
        this._timestamps = [];
    }
}
exports.AdaptivePacer = AdaptivePacer;

// ── Presence / Typing Throttle ────────────────────────────────────────────────

/**
 * PresenceThrottle prevents sending presence/typing events too rapidly.
 * WhatsApp flags accounts that send composing events continuously.
 */
class PresenceThrottle {
    /**
     * @param opts.minIntervalMs  Minimum ms between presence events (default 4000)
     * @param opts.maxTypingMs    Max duration of a single "composing" event (default 8000)
     */
    constructor(opts = {}) {
        this.minIntervalMs = opts.minIntervalMs ?? 4000;
        this.maxTypingMs = opts.maxTypingMs ?? 8000;
        this._lastSent = 0;
        this._typingTimer = null;
    }

    /**
     * Call before sending a presence/composing event.
     * Returns true if the event should be sent, false if it should be suppressed.
     */
    shouldSendPresence() {
        const now = Date.now();
        if (now - this._lastSent < this.minIntervalMs) return false;
        this._lastSent = now;
        return true;
    }

    /**
     * Simulate realistic typing: starts composing, then pauses after maxTypingMs.
     * @param sendPresence  Async function that sends a presence update
     * @param jidOrChat     Chat JID to type in
     */
    async simulateTyping(sendPresence, jidOrChat, durationMs) {
        if (!this.shouldSendPresence()) return;
        const duration = durationMs ?? Math.floor(secureRandom(1500, this.maxTypingMs));
        await sendPresence(jidOrChat, 'composing');
        await sleep(duration);
        await sendPresence(jidOrChat, 'paused');
    }

    clear() {
        if (this._typingTimer) clearTimeout(this._typingTimer);
    }
}
exports.PresenceThrottle = PresenceThrottle;

// ── Anti-Burst Limiter ────────────────────────────────────────────────────────

/**
 * Token-bucket burst limiter.
 * Allows short bursts while enforcing a sustained send rate.
 */
class AntiBurstLimiter {
    /**
     * @param opts.tokensPerSecond  Sustained rate (default 0.5 = 1 msg every 2s)
     * @param opts.maxBurst         Max tokens in bucket (default 5)
     */
    constructor(opts = {}) {
        this.tokensPerSecond = opts.tokensPerSecond ?? 0.5;
        this.maxBurst = opts.maxBurst ?? 5;
        this._tokens = this.maxBurst;
        this._lastRefill = Date.now();
    }

    _refill() {
        const now = Date.now();
        const elapsed = (now - this._lastRefill) / 1000;
        this._tokens = Math.min(this.maxBurst, this._tokens + elapsed * this.tokensPerSecond);
        this._lastRefill = now;
    }

    /** Acquire a token. Waits until one is available. */
    async acquire() {
        this._refill();
        if (this._tokens >= 1) {
            this._tokens -= 1;
            return;
        }
        // Calculate wait time for next token
        const waitSec = (1 - this._tokens) / this.tokensPerSecond;
        await sleep(Math.ceil(waitSec * 1000));
        this._tokens = Math.max(0, this._tokens - 1);
    }

    available() {
        this._refill();
        return this._tokens;
    }
}
exports.AntiBurstLimiter = AntiBurstLimiter;

// ── Safer Reconnect Pacing ────────────────────────────────────────────────────

/**
 * Returns a reconnect delay using exponential backoff with jitter.
 * Prevents hammering WA servers on disconnect.
 *
 * @param attempt    Current reconnect attempt (0-indexed)
 * @param baseMs     Base delay in ms (default 3000)
 * @param maxMs      Maximum delay cap in ms (default 60_000)
 * @param jitterMs   Max random jitter in ms (default 2000)
 */
const safeReconnectDelay = (attempt, baseMs = 3000, maxMs = 60_000, jitterMs = 2000) => {
    const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
    const jitter = secureRandom(0, jitterMs);
    return Math.floor(exp + jitter);
};
exports.safeReconnectDelay = safeReconnectDelay;

// ── Safer Retry Handling ──────────────────────────────────────────────────────

/**
 * Retry an async operation with safe backoff.
 *
 * @param fn           Async function to retry
 * @param maxRetries   Max number of retries (default 5)
 * @param baseDelayMs  Base delay between retries in ms (default 2000)
 * @param onRetry      Optional callback called on each retry (attempt, error)
 */
const safeRetry = async (fn, maxRetries = 5, baseDelayMs = 2000, onRetry) => {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt >= maxRetries) break;
            const delay = safeReconnectDelay(attempt, baseDelayMs, 30_000, 1000);
            if (onRetry) onRetry(attempt + 1, err);
            await sleep(delay);
        }
    }
    throw lastErr;
};
exports.safeRetry = safeRetry;

// ── Unified AntiBan Instance Factory ─────────────────────────────────────────

/**
 * Creates a pre-configured anti-ban bundle for a single session.
 *
 * @example
 * const ab = createAntiBan({ burstLimit: 15 });
 * await ab.pacer.pace();           // before sending
 * await ab.burst.acquire();        // token-bucket gate
 * await ab.presence.simulateTyping(sendPresence, jid);
 */
const createAntiBan = (opts = {}) => {
    return {
        pacer: new AdaptivePacer({
            windowMs: opts.windowMs,
            burstLimit: opts.burstLimit,
            slowdownMs: opts.slowdownMs,
        }),
        burst: new AntiBurstLimiter({
            tokensPerSecond: opts.tokensPerSecond,
            maxBurst: opts.maxBurst,
        }),
        presence: new PresenceThrottle({
            minIntervalMs: opts.minPresenceIntervalMs,
            maxTypingMs: opts.maxTypingMs,
        }),
        reconnectDelay: (attempt) => safeReconnectDelay(
            attempt,
            opts.reconnectBaseMs,
            opts.reconnectMaxMs,
            opts.reconnectJitterMs
        ),
        retry: (fn, retries, onRetry) => safeRetry(fn, retries ?? opts.maxRetries, opts.retryBaseMs, onRetry),
        randomInterval: (base, jitter) => randomInterval(base, jitter),
    };
};
exports.createAntiBan = createAntiBan;

/** Default singleton — ready to use without configuration */
exports.AntiBan = createAntiBan();
