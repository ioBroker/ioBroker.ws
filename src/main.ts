import { Adapter, type AdapterOptions, EXIT_CODES, commonTools } from '@iobroker/adapter-core'; // Get common this utils
import { WebServer } from '@iobroker/webserver';
import SocketWS from './lib/socketWS';
import ws from '@iobroker/ws-server';
import type { Express } from 'express';
import type { Store } from 'express-session';
import { randomBytes } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';

declare global {
    namespace ioBroker {
        interface AdapterConfig {
            port: number;
            auth: boolean;
            secure: boolean;
            bind: string;
            ttl: number;
            certPublic: string;
            certPrivate: string;
            certChained: string;
            defaultUser: string;
            leEnabled: boolean;
            leUpdate: boolean;
            leCheckPort: number;

            certificates: ioBroker.Certificates;
            leConfig: boolean;
            crossDomain: boolean;
            forceWebSockets: boolean;
            findNextPort: boolean;
        }
    }
}

class WsAdapter extends Adapter {
    #store: Store | null = null;

    #secret: string = 'Zgfr56gFe87jJOM';

    #bruteForce: Record<string, { errors: number; time: number }> = {};

    #webServer: {
        app: Express | null;
        server: HttpServer | HttpsServer | null;
        io: SocketWS | null;
        settings: ioBroker.AdapterConfig;
    } | null = null;

    constructor(options: Partial<AdapterOptions> = {}) {
        options = options || {};

        Object.assign(options, {
            name: 'ws',

            objectChange: (id: string, obj: ioBroker.Object | null | undefined) => {
                this.#webServer?.io?.publishAll('objectChange', id, obj);
            },

            stateChange: (id: string, state: ioBroker.State | null | undefined) => {
                this.#webServer?.io?.publishAll('stateChange', id, state);
            },

            fileChange: (id: string, fileName: string, size: number | null | undefined) => {
                this.#webServer?.io?.publishFileAll(id, fileName, size);
            },

            unload: async (callback: () => void) => {
                try {
                    if (this.setStateAsync) {
                        await this.setStateAsync('info.connected', '', true);
                        await this.setStateAsync('info.connection', false, true);
                    }

                    this.log.info(
                        `terminating http${this.config.secure ? 's' : ''} server on port ${this.config.port}`,
                    );
                    this.#webServer.io.close();
                    this.#webServer.server.close();
                } catch {
                    // ignore
                }
                callback();
            },

            ready: async () => {
                if (this.config.auth) {
                    // Generate secret for session manager
                    this.getForeignObject('system.config', async (err, obj) => {
                        if (!err && obj) {
                            if (!obj.native?.secret) {
                                obj.native = obj.native || {};
                                randomBytes(24, (ex, buf) => {
                                    this.#secret = buf.toString('hex');
                                    this.extendForeignObject('system.config', { native: { secret: this.#secret } });
                                    this.main();
                                });
                            } else {
                                this.#secret = obj.native.secret;
                                await this.main();
                            }
                        } else {
                            this.log.error('Cannot find object "system.config"');
                        }
                    });
                } else {
                    await this.main();
                }
            },

            message: (obj: ioBroker.Message) => {
                if (obj?.command !== 'im') {
                    // if not instance message
                    return;
                }

                // to make messages shorter, we code the answer as:
                // m - message type
                // s - socket ID
                // d - data
                this.#webServer?.io?.publishInstanceMessageAll(obj.from, obj.message.m, obj.message.s, obj.message.d);
            },
        });

        super(options as AdapterOptions);

        this.on('log', (obj: Record<string, unknown>) => this.#webServer?.io?.sendLog(obj));

        return this;
    }

    async main() {
        if (this.config.secure) {
            // Load certificates
            this.getCertificates(
                this.config.certPublic,
                this.config.certPrivate,
                this.config.certChained,
                async (
                    err?: Error | null,
                    certificates?: ioBroker.Certificates,
                    useLetsEncryptCert?: boolean,
                ): Promise<void> => {
                    this.config.certificates = certificates;
                    this.config.leConfig = useLetsEncryptCert;
                    await this.initWebServer();
                },
            );
        } else {
            await this.initWebServer();
        }
    }

    checkUser = (username: string, password: string, cb: (err: string | null, user: string | false) => void): void => {
        username = (username || '')
            .toString()
            .replace(this.FORBIDDEN_CHARS, '_')
            .replace(/\s/g, '_')
            .replace(/\./g, '_')
            .toLowerCase();

        if (this.#bruteForce[username] && this.#bruteForce[username].errors > 4) {
            let minutes = Date.now() - this.#bruteForce[username].time;
            if (this.#bruteForce[username].errors < 7) {
                if (Date.now() - this.#bruteForce[username].time < 60000) {
                    minutes = 1;
                } else {
                    minutes = 0;
                }
            } else if (this.#bruteForce[username].errors < 10) {
                if (Date.now() - this.#bruteForce[username].time < 180000) {
                    minutes = Math.ceil((180000 - minutes) / 60000);
                } else {
                    minutes = 0;
                }
            } else if (this.#bruteForce[username].errors < 15) {
                if (Date.now() - this.#bruteForce[username].time < 600000) {
                    minutes = Math.ceil((600000 - minutes) / 60000);
                } else {
                    minutes = 0;
                }
            } else if (Date.now() - this.#bruteForce[username].time < 3600000) {
                minutes = Math.ceil((3600000 - minutes) / 60000);
            } else {
                minutes = 0;
            }

            if (minutes) {
                return cb(`Too many errors. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`, false);
            }
        }

        this.checkPassword(username, password, (res: boolean): void => {
            if (!res) {
                if (!this.#bruteForce[username]) {
                    this.#bruteForce[username] = { errors: 0, time: Date.now() };
                } else {
                    this.#bruteForce[username].time = Date.now();
                }
                this.#bruteForce[username].errors++;
            } else if (this.#bruteForce[username]) {
                delete this.#bruteForce[username];
            }

            if (res) {
                return cb(null, username);
            }
            return cb(null, false);
        });
    };

    //this.config: {
    //    "port":   8080,
    //    "auth":   false,
    //    "secure": false,
    //    "bind":   "0.0.0.0", // "::"
    //}
    async initWebServer(): Promise<void> {
        this.#webServer = {
            app: null,
            server: null,
            io: null,
            settings: this.config,
        };

        this.config.port = parseInt(this.config.port as unknown as string, 10) || 0;

        if (this.config.port) {
            if (this.config.secure && !this.config.certificates) {
                return null;
            }

            this.config.crossDomain = true;
            this.config.ttl = this.config.ttl || 3600;
            this.config.forceWebSockets = this.config.forceWebSockets || false;

            if (this.config.auth) {
                const { default: session } = await import('express-session');
                const AdapterStore = commonTools.session(session, this.config.ttl);
                // Authentication checked by server itself
                this.#store = new AdapterStore({ this: this });
            }

            this.getPort(
                this.config.port,
                !this.config.bind || this.config.bind === '0.0.0.0' ? undefined : this.config.bind || undefined,
                async (port: number) => {
                    if (parseInt(port as unknown as string, 10) !== this.config.port && !this.config.findNextPort) {
                        this.log.error(`port ${this.config.port} already in use`);
                        return this.terminate
                            ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                    }

                    this.config.port = port;

                    try {
                        const webServer = new WebServer({
                            app: this.#webServer.app,
                            adapter: this,
                            secure: this.config.secure,
                        });

                        this.#webServer.server = await webServer.init();
                    } catch (err) {
                        this.log.error(`Cannot create this.#webServer: ${err}`);
                        this.terminate
                            ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                        return;
                    }
                    if (!this.#webServer.server) {
                        this.log.error(`Cannot create this.#webServer`);
                        this.terminate
                            ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                        return;
                    }

                    let serverListening = false;
                    this.#webServer.server.on('error', e => {
                        if (e.toString().includes('EACCES') && port <= 1024) {
                            this.log.error(
                                `node.js process has no rights to start server on the port ${port}.\n` +
                                    'Do you know that on linux you need special permissions for ports under 1024?\n' +
                                    'You can call in shell following scrip to allow it for node.js: "iobroker fix"',
                            );
                        } else {
                            this.log.error(`Cannot start server on ${this.config.bind || '0.0.0.0'}:${port}: ${e}`);
                        }
                        if (!serverListening) {
                            this.terminate
                                ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                                : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                        }
                    });

                    // Start the web server
                    this.#webServer.server.listen(
                        this.config.port,
                        !this.config.bind || this.config.bind === '0.0.0.0' ? undefined : this.config.bind || undefined,
                        () => {
                            this.setState('info.connection', true, true);
                            serverListening = true;
                        },
                    );

                    this.#webServer.io = new SocketWS(this.config, this);
                    this.#webServer.io.start(this.#webServer.server, ws, {
                        userKey: 'connect.sid',
                        checkUser: this.checkUser,
                        store: this.#store,
                        secret: this.#secret,
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
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new WsAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new WsAdapter())();
}
