/*!
 * Build tasks of ioBroker.ws
 *
 * `npm run build` compiles `src/` with tsc and then runs this file, which places the socket.io
 * compatibility shim of @iobroker/ws-server-library into `build/lib/`. Clients that still speak
 * socket.io ask the adapter for `socket.io.js`, and only `build/` is published, so the shim has
 * to travel with it.
 *
 * This file is run straight from source - `node tasks.mts` - by the type stripping node brings
 * along, so it must stay free of syntax that a compiler would have to rewrite (`enum`,
 * `namespace`, parameter properties). `npm run check` enforces that with `erasableSyntaxOnly`.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Directory of this file, and with it the root of the adapter */
const ROOT: string = import.meta.dirname;
/** Directory the compiled sources live in */
const BUILD_LIB = `${ROOT}/build/lib`;

/** Copies the socket.io shim of `@iobroker/ws-server-library` into `build/lib/` */
function copySocketIo(): void {
    const source = fileURLToPath(import.meta.resolve('@iobroker/ws-server-library/socket.io.js'));
    mkdirSync(BUILD_LIB, { recursive: true });
    copyFileSync(source, `${BUILD_LIB}/socket.io.js`);
}

try {
    copySocketIo();
} catch (e: unknown) {
    console.error(`Cannot copy socket.io.js: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
}
