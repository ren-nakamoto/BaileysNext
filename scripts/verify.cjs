'use strict';

/*
 * Runtime smoke test for the distributed CommonJS build.
 * This catches the class of bugs this fork had: package installs that fail,
 * missing runtime dependencies, and helper exports that silently disappear.
 */
const assert = require('node:assert/strict');

const baileys = require('../lib');

assert.equal(typeof baileys.default, 'function', 'default export must be makeWASocket');
assert.equal(typeof baileys.makeWASocket, 'function', 'named makeWASocket export is required');
assert.equal(typeof baileys.patchModernSocket, 'function', 'modern helper patcher must be exported');
assert.equal(typeof baileys.normalizeStoryParticipant, 'function', 'status participant normalizer must be exported');

const fakeSocket = {
  sendMessage: async (_jid, payload) => payload,
  chatModify: async (payload, jid) => ({ jid, payload }),
  relayMessage: async (jid, payload, options) => ({ jid, payload, options }),
  readMessages: async keys => keys,
  requestPairingCode: async phone => `PAIR-${phone}`
};

const patched = baileys.patchModernSocket(fakeSocket);
assert.equal(patched, fakeSocket, 'patchModernSocket should mutate and return the original socket');
assert.equal(typeof patched.reactStatus, 'function', 'reactStatus helper should be installed');
assert.equal(typeof patched.sendPollMessage, 'function', 'sendPollMessage helper should be installed');
assert.equal(typeof patched.requestPairingCodeSafe, 'function', 'safe pairing helper should be installed');


(async () => {
  const makeCacheManagerAuthState = require('../lib/Store/make-cache-manager-store').default;
  const auth = await makeCacheManagerAuthState(undefined, 'verify-session');
  assert.equal(typeof auth.clearState, 'function', 'cache auth state should expose clearState');
  assert.equal(typeof auth.saveCreds, 'function', 'cache auth state should expose saveCreds');
  await auth.saveCreds();
  await auth.clearState();
  console.log('BaileysNext runtime verification passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

