# BaileysNext May 2026 Hardened Build

A CommonJS-compatible Baileys fork with May 2026 dependency refreshes, runtime smoke checks, and compatibility helpers for status reactions, polls, message edits/deletes, contact cards, albums, chat archive/mute, pairing codes, and newsletter metadata.

## Requirements

- Node.js `>=20.19.0`
- npm `>=10.8.0`

## Install

```bash
npm install
```

## Verify

```bash
npm test
npm run build:tsc
npm run lint
npm audit --audit-level=moderate
```

`npm run lint` currently exits successfully but reports warnings from legacy/generated CommonJS files. These warnings are listed in the upgrade report and should be cleaned during a full TypeScript source migration.

## Use

```js
const { default: makeWASocket, useMultiFileAuthState } = require('baileys');

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const sock = makeWASocket({ auth: state });

  sock.ev.on('creds.update', saveCreds);
}

start().catch(console.error);
```

## Runtime helpers

`makeWASocket()` automatically applies `patchModernSocket()`, exposing:

- `sock.reactStatus()` / `sock.sendStatusReaction()`
- `sock.readStatus()`
- `sock.sendPollMessage()`
- `sock.editMessage()`
- `sock.deleteMessage()`
- `sock.pinMessage()` / `sock.unpinMessage()`
- `sock.sendContactCard()` / `sock.sendContacts()`
- `sock.sendAlbumMessage()`
- `sock.archiveChat()`
- `sock.muteChat()` / `sock.unmuteChat()`
- `sock.requestPairingCodeSafe()`
- `sock.newsletterMetadataSafe()`

## ZIP-ready structure

```text
BaileysNext/
  WAProto/
  WASignalGroup/
  lib/
  scripts/
    verify.cjs
  eslint.config.js
  package.json
  package-lock.json
  README.md
  MAY2026_UPGRADE_NOTES.md
  REACTION_PORT_NOTES.md
  tsconfig.json
  typedoc.json
```

## Notes

This build intentionally keeps the shipped CommonJS layout to avoid breaking existing bots. A complete migration to official modern Baileys architecture, ESM-only packaging, and source-first TypeScript should be handled as a separate major version.
