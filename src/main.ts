import { randomBytes } from 'node:crypto';
import type { IncomingMessage, OutgoingMessage, Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';

import * as session from 'express-session';

import { Adapter, type AdapterOptions, commonTools, EXIT_CODES } from '@iobroker/adapter-core'; // Get common adapter utils
import { WebServer } from '@iobroker/webserver';
import { SocketIO } from '@iobroker/ws-server';
import type { SocketSettings, Store } from '@iobroker/socket-classes';

import type { WsAdapterConfig } from './types';
import { SocketWS } from './lib/socketWS';

type Server = HttpServer | HttpsServer;

export class WsAdapter extends Adapter {
    private wsConfig: WsAdapterConfig;
    private server: {
        server: null | Server;
        io: null | SocketWS;
        app: ((req: IncomingMessage, res: OutgoingMessage) => void) | null;
    } = {
        server: null,
        io: null,
        app: null,
    };
    private readonly socketIoFile: string;
    private store: Store | null = null;
    private secret = 'Zgfr56gFe87jJOM';
    private certificates: ioBroker.Certificates | undefined;

    private bruteForce: { [ip: string]: { errors: number; time: number } } = {};

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'ws',
            unload: callback => this.onUnload(callback),
            message: obj => this.onMessage(obj),
            stateChange: (id, state) => {
                this.server?.io?.publishAll('stateChange', id, state);
            },
            ready: () => this.main(),
            objectChange: (id: string, obj: ioBroker.Object | null | undefined): void => {
                this.server?.io?.publishAll('objectChange', id, obj);
            },
            fileChange: (id: string, fileName: string, size: number | null): void => {
                this.server?.io?.publishFileAll(id, fileName, size);
            },
        });

        this.socketIoFile = readFileSync(`${__dirname}/lib/socket.io.js`).toString('utf-8');
        this.wsConfig = this.config as WsAdapterConfig;
        this.on('log', (obj: ioBroker.LogMessage): void => this.server?.io?.sendLog(obj));
    }

    onUnload(callback: () => void): void {
        try {
            void this.setState('info.connected', '', true);
            void this.setState('info.connection', false, true);
            this.log.info(`terminating http${this.wsConfig.secure ? 's' : ''} server on port ${this.wsConfig.port}`);
            this.server.io?.close();
            this.server.server?.close();

            callback();
        } catch {
            callback();
        }
    }

    onMessage(obj: ioBroker.Message): void {
        if (obj?.command !== 'im') {
            // if not instance message
            return;
        }

        // to make messages shorter, we code the answer as:
        // m - message type
        // s - socket ID
        // d - data
        this.server?.io?.publishInstanceMessageAll(obj.from, obj.message.m, obj.message.s, obj.message.d);
    }

    checkUser = (
        username: string,
        password: string,
        cb: (
            error: null | Error,
            result?: {
                logged_in: boolean;
            },
        ) => void,
    ): void => {
        username = (username || '')
            .toString()
            .replace(this.FORBIDDEN_CHARS, '_')
            .replace(/\s/g, '_')
            .replace(/\./g, '_')
            .toLowerCase();

        if (this.bruteForce[username] && this.bruteForce[username].errors > 4) {
            let minutes = Date.now() - this.bruteForce[username].time;
            if (this.bruteForce[username].errors < 7) {
                if (Date.now() - this.bruteForce[username].time < 60000) {
                    minutes = 1;
                } else {
                    minutes = 0;
                }
            } else if (this.bruteForce[username].errors < 10) {
                if (Date.now() - this.bruteForce[username].time < 180000) {
                    minutes = Math.ceil((180000 - minutes) / 60000);
                } else {
                    minutes = 0;
                }
            } else if (this.bruteForce[username].errors < 15) {
                if (Date.now() - this.bruteForce[username].time < 600000) {
                    minutes = Math.ceil((600000 - minutes) / 60000);
                } else {
                    minutes = 0;
                }
            } else if (Date.now() - this.bruteForce[username].time < 3600000) {
                minutes = Math.ceil((3600000 - minutes) / 60000);
            } else {
                minutes = 0;
            }

            if (minutes) {
                return cb(
                    new Error(`Too many errors. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`),
                );
            }
        }

        void this.checkPassword(username, password, (success: boolean, _user: string): void => {
            if (!success) {
                this.bruteForce[username] = this.bruteForce[username] || { errors: 0 };
                this.bruteForce[username].time = Date.now();
                this.bruteForce[username].errors++;
            } else if (this.bruteForce[username]) {
                delete this.bruteForce[username];
            }

            if (success) {
                return cb(null, { logged_in: true });
            }
            return cb(null);
        });
    };

    initWebServer(): void {
        this.wsConfig.port = parseInt(this.wsConfig.port as string, 10) || 0;

        if (this.wsConfig.port) {
            if (this.wsConfig.secure && !this.certificates) {
                return;
            }

            this.wsConfig.ttl = this.wsConfig.ttl || 3600;

            if (this.wsConfig.auth) {
                const AdapterStore = commonTools.session(session, this.wsConfig.ttl);
                // Authentication checked by server itself
                this.store = new AdapterStore({ adapter: this });
            }

            this.getPort(
                this.wsConfig.port,
                !this.wsConfig.bind || this.wsConfig.bind === '0.0.0.0' ? undefined : this.wsConfig.bind || undefined,
                async (port: number): Promise<void> => {
                    if (parseInt(port as unknown as string, 10) !== this.wsConfig.port) {
                        this.log.error(`port ${this.wsConfig.port} already in use`);
                        return this.terminate
                            ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                    }

                    this.server.app = (req: IncomingMessage, res: OutgoingMessage): void => {
                        if (req.url?.includes('socket.io.js')) {
                            // @ts-expect-error
                            res.writeHead(200, { 'Content-Type': 'text/plain' });
                            res.end(this.socketIoFile);
                        } else {
                            // @ts-expect-error
                            res.writeHead(404);
                            res.end('Not found');
                        }
                    };

                    try {
                        const webserver = new WebServer({
                            adapter: this,
                            secure: this.wsConfig.secure,
                            app: this.server.app,
                        });

                        this.server.server = await webserver.init();
                    } catch (err) {
                        this.log.error(`Cannot create server: ${err}`);
                        this.terminate
                            ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                        return;
                    }
                    if (!this.server.server) {
                        this.log.error(`Cannot create server`);
                        this.terminate
                            ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                        return;
                    }

                    let serverListening = false;
                    this.server.server.on('error', e => {
                        if (e.toString().includes('EACCES') && port <= 1024) {
                            this.log.error(
                                `node.js process has no rights to start server on the port ${port}.\n` +
                                    'Do you know that on linux you need special permissions for ports under 1024?\n' +
                                    'You can call in shell following scrip to allow it for node.js: "iobroker fix"',
                            );
                        } else {
                            this.log.error(`Cannot start server on ${this.wsConfig.bind || '0.0.0.0'}:${port}: ${e}`);
                        }
                        if (!serverListening) {
                            this.terminate
                                ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                                : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                        }
                    });

                    // Start the web server
                    this.server.server.listen(
                        this.wsConfig.port,
                        !this.wsConfig.bind || this.wsConfig.bind === '0.0.0.0'
                            ? undefined
                            : this.wsConfig.bind || undefined,
                        () => {
                            void this.setState('info.connection', true, true);
                            serverListening = true;
                        },
                    );

                    const settings: SocketSettings = {
                        ttl: this.wsConfig.ttl as number,
                        port: this.wsConfig.port,
                        secure: this.wsConfig.secure,
                        auth: this.wsConfig.auth,
                        crossDomain: true,
                        forceWebSockets: true, // this is irrelevant for ws
                        defaultUser: this.wsConfig.defaultUser,
                        language: this.wsConfig.language,
                        secret: this.secret,
                    };

                    this.server.io = new SocketWS(settings, this);
                    this.server.io.start(this.server.server, SocketIO, {
                        checkUser: this.checkUser,
                        store: this.store!,
                        secret: this.secret,
                    });
                },
            );
        } else {
            this.log.error('port missing');
            this.terminate
                ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
        }
    }

    async main(): Promise<void> {
        this.wsConfig = this.config as WsAdapterConfig;

        if (this.wsConfig.auth) {
            // Generate secret for session manager
            const systemConfig = await this.getForeignObjectAsync('system.config');
            if (systemConfig) {
                if (!systemConfig.native?.secret) {
                    systemConfig.native = systemConfig.native || {};
                    await new Promise<void>(resolve =>
                        randomBytes(24, (_err: Error | null, buf: Buffer): void => {
                            this.secret = buf.toString('hex');
                            void this.extendForeignObject('system.config', { native: { secret: this.secret } });
                            resolve();
                        }),
                    );
                } else {
                    this.secret = systemConfig.native.secret;
                }
            } else {
                this.log.error('Cannot find object system.config');
            }
        }

        if (this.wsConfig.secure) {
            // Load certificates
            await new Promise<void>(resolve =>
                this.getCertificates(
                    undefined,
                    undefined,
                    undefined,
                    (_err: Error | null | undefined, certificates: ioBroker.Certificates | undefined): void => {
                        this.certificates = certificates;
                        resolve();
                    },
                ),
            );
        }

        this.initWebServer();
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new WsAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new WsAdapter())();
}
