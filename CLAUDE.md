# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

ioBroker.ws is a WebSocket communication adapter for ioBroker. It enables web applications and other adapters to communicate with ioBroker using pure WebSockets (not socket.io). Since v4.0, socket.io is only simulated over pure WebSockets.

## Commands

- **Build:** `npm run build` (compiles TypeScript via `tsconfig.build.json`, then runs `tasks.js` to copy socket.io shim and type defs)
- **Lint:** `npm run lint`
- **Test all:** `npm test` (runs integration tests via mocha with `--exit`)
- **Test package only:** `npm run test:package`
- **Single test file:** `npx mocha test/testAdapter.js --exit`

## Architecture

**Source in `src/`, compiled output in `build/`.** Entry point: `src/main.ts` -> `build/main.js`.

Three main classes form the core:

1. **WsAdapter** (`src/main.ts`) - The ioBroker adapter. Extends `@iobroker/adapter-core`. Sets up Express HTTP/HTTPS server with authentication middleware, then hands it to the WebSocket layer. Supports auth via Bearer tokens, Basic auth, cookies, query params, and OAuth2.

2. **SocketWS** (`src/lib/socketWS.ts`) - Extends `SocketCommon` from `@iobroker/socket-classes`. Handles WebSocket authentication via Passport, session management, and publishes state/object/file changes to all connected clients.

3. **Socket** (`src/lib/socket.ts`) - Thin wrapper around SocketWS for backward compatibility and a clean public interface.

**Data flow:** Client WebSocket -> SocketWS -> WsAdapter -> ioBroker core, and reverse for state/object change notifications via `publishAll()`.

**Key dependencies:**
- `@iobroker/ws-server` - The pure WebSocket server implementation
- `@iobroker/socket-classes` - Shared socket communication logic (base class `SocketCommon`)
- `@iobroker/webserver` - HTTP/HTTPS server management with Let's Encrypt support
- `express` v5 with `express-session`, `cookie-parser`, `body-parser`

**Post-build step (`tasks.js`):** Copies `node_modules/@iobroker/ws/dist/esm/socket.io.js` to `build/lib/socket.io.js` (client-side compatibility shim) and `src/types.d.ts` to `build/types.d.ts`.

## Configuration

Adapter configuration schema is in `admin/jsonConfig.json`. Key settings: port (default 8084), auth, secure (HTTPS), certificates, TTL, default user. Adapter metadata lives in `io-package.json`.

## Testing

Uses Mocha + Chai. Integration tests (`test/testAdapter.js`) spin up a js-controller instance via `@iobroker/legacy-testing` and verify adapter startup, alive state, and connection status. Tests have long timeouts (600s for controller, 60s for adapter).

## TypeScript

- `tsconfig.json` - Type checking only (`noEmit: true`), strict mode, target ES2022, module Node16
- `tsconfig.build.json` - Extends root, enables emit for compilation
- Node.js >= 20 required

## Linting

ESLint uses `@iobroker/eslint-config`. JSDoc rules are disabled. Linting ignores `build/`, `example/`, and `test/` directories.

## Release

Uses `@alcalzone/release-script` with ioBroker and license plugins. Pre-commit hook runs `npm run build`. Release commands: `npm run release-patch`, `npm run release-minor`, `npm run release-major`.
