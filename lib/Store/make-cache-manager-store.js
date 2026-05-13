"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cache_manager_1 = require("cache-manager");
const WAProto_1 = require("../../WAProto");
const Utils_1 = require("../Utils");
const logger_1 = __importDefault(require("../Utils/logger"));

const TWO_YEARS_MS = 63115200 * 1000;

const createCacheManager = (store) => {
    // cache-manager v7 removed the old `caching()` factory. `createCache()` is the
    // supported API and uses milliseconds for TTL values. Keeping this wrapper
    // makes old callers work while allowing modern Keyv stores to be passed in.
    if (!store) {
        return (0, cache_manager_1.createCache)();
    }
    if (Array.isArray(store)) {
        return (0, cache_manager_1.createCache)({ stores: store });
    }
    if (typeof store.get === 'function' && typeof store.set === 'function') {
        return (0, cache_manager_1.createCache)({ stores: [store] });
    }
    return (0, cache_manager_1.createCache)(store);
};

const listKeysByPrefix = async (cache, prefix) => {
    const keys = [];
    for (const store of cache.stores || []) {
        // Keyv-compatible stores expose an async iterator. Prefer it because
        // cache-manager v7 no longer exposes the legacy `store.keys(pattern)` API.
        if (store && typeof store.iterator === 'function') {
            for await (const [key] of store.iterator()) {
                if (typeof key === 'string' && key.startsWith(prefix)) keys.push(key);
            }
        }
        else if (store && typeof store.keys === 'function') {
            const storeKeys = await store.keys();
            keys.push(...storeKeys.filter(key => typeof key === 'string' && key.startsWith(prefix)));
        }
    }
    return [...new Set(keys)];
};

const makeCacheManagerAuthState = async (store, sessionKey) => {
    if (!sessionKey || typeof sessionKey !== 'string') {
        throw new Error('makeCacheManagerAuthState requires a non-empty sessionKey');
    }
    const defaultKey = (file) => `${sessionKey}:${file}`;
    const databaseConn = createCacheManager(store);
    const writeData = async (file, data) => {
        const ttl = file === 'creds' ? TWO_YEARS_MS : undefined;
        // cache-manager v7 uses an options object for TTL. Passing seconds here
        // would expire credentials too early, so we explicitly pass milliseconds.
        await databaseConn.set(defaultKey(file), JSON.stringify(data, Utils_1.BufferJSON.replacer), ttl ? { ttl } : undefined);
    };
    const readData = async (file) => {
        try {
            const data = await databaseConn.get(defaultKey(file));
            if (data) {
                return JSON.parse(data, Utils_1.BufferJSON.reviver);
            }
            return null;
        }
        catch (error) {
            logger_1.default.error(error);
            return null;
        }
    };
    const removeData = async (file) => {
        try {
            return await databaseConn.del(defaultKey(file));
        }
        catch (_a) {
            logger_1.default.error(`Error removing ${file} from session ${sessionKey}`);
        }
    };
    const clearState = async () => {
        try {
            const result = await listKeysByPrefix(databaseConn, `${sessionKey}:`);
            await Promise.all(result.map(async (key) => await databaseConn.del(key)));
        }
        catch (err) {
            logger_1.default.error(err, `Error clearing session ${sessionKey}`);
        }
    };
    const creds = (await readData('creds')) || (0, Utils_1.initAuthCreds)();
    return {
        clearState,
        saveCreds: () => writeData('creds', creds),
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = WAProto_1.proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(key, value) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                },
            }
        }
    };
};
exports.default = makeCacheManagerAuthState;
