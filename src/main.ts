import { randomBytes } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';

import * as session from 'express-session';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import * as bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';

import { Adapter, type AdapterOptions, commonTools, EXIT_CODES } from '@iobroker/adapter-core'; // Get common adapter utils
import { WebServer, createOAuth2Server } from '@iobroker/webserver';
import { SocketIO } from '@iobroker/ws-server';
import type { SocketSettings, Store } from '@iobroker/socket-classes';

import type { WsAdapterConfig } from './types';
import { SocketWS } from './lib/socketWS';

type Server = HttpServer | HttpsServer;

export class WsAdapter extends Adapter {
    declare public config: WsAdapterConfig;
    private server: {
        server: null | Server;
        io: null | SocketWS;
        app: Express | null;
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
        this.on('log', (obj: ioBroker.LogMessage): void => this.server?.io?.sendLog(obj));
    }

    onUnload(callback: () => void): void {
        try {
            void this.setState('info.connected', '', true);
            void this.setState('info.connection', false, true);
            this.log.info(`terminating http${this.config.secure ? 's' : ''} server on port ${this.config.port}`);
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
                user?: string;
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

    detectUser = (req: Request, res: Response, next: NextFunction): void => {
        if (this.config.auth) {
            // Try to extract user name from query or access token
            if (req.query?.user && req.query.pass) {
                // Check user and password
                void this.checkPassword(
                    req.query.user as string,
                    req.query.pass as string,
                    (res: boolean, user: string): void => {
                        if (res) {
                            // Store it
                            req.user = user.startsWith(`system.adapter.`) ? user : `system.adapter.${user}`;
                        }
                        next();
                    },
                );
                return;
            } else if (req.query?.token || req.headers.authorization?.startsWith('Bearer ')) {
                const accessToken = (req.query?.token as string) || req.headers.authorization?.split(' ')[1];
                void this.getSession(`a:${accessToken}`, obj => {
                    if (obj?.user) {
                        req.user = obj.user.startsWith(`system.adapter.`) ? obj.user : `system.adapter.${obj.user}`;
                    }
                    next();
                });
                return;
            } else if (req.headers.cookie) {
                const parts = req.headers.cookie.split(' ');
                for (let i = 0; i < parts.length; i++) {
                    const pair = parts[i].split('=');
                    if (pair[0] === 'access_token') {
                        void this.getSession(`a:${pair[1]}`, obj => {
                            if (obj?.user) {
                                req.user = obj.user.startsWith(`system.adapter.`)
                                    ? obj.user
                                    : `system.adapter.${obj.user}`;
                            }
                            next();
                        });
                        return;
                    }
                }
            } else if (req.headers.authorization?.startsWith('Basic ')) {
                const parts = Buffer.from(req.headers.authorization.split(' ')[1], 'base64')
                    .toString('utf8')
                    .split(':');
                const user = parts.shift();
                const pass = parts.join(':');
                if (user && pass) {
                    void this.checkPassword(user, pass, (res: boolean, user: string): void => {
                        if (res) {
                            // Store it
                            req.user = user.startsWith(`system.adapter.`) ? user : `system.adapter.${user}`;
                        }
                        next();
                    });
                    return;
                }
            }
        } else {
            req.user = this.config.defaultUser || 'system.user.admin';
        }
        next();
    };

    serveStaticFile = (req: Request, res: Response, next: NextFunction): void => {
        const url = req.url.split('?')[0];

        if (this.config.auth && (!url || url === '/' || url === '/index.html')) {
            if (!req.user || url.includes('..')) {
                res.setHeader('Content-Type', 'text/html');
                res.send(readFileSync(`${__dirname}/../public/index.html`));
                return;
            }

            if (existsSync(`${__dirname}/../example/index.html`)) {
                res.setHeader('Content-Type', 'text/html');
                res.send(readFileSync(`${__dirname}/../example/index.html`));
                return;
            }
        } else if (!url.includes('..')) {
            if (existsSync(`${__dirname}/../example${url === '/' ? '/index.html' : url}`)) {
                res.setHeader('Content-Type', url === '/' || url.endsWith('.html') ? 'text/html' : 'text/javascript');
                res.send(readFileSync(`${__dirname}/../example${url === '/' ? '/index.html' : url}`));
                return;
            }
        }

        // Special case for "example" file
        if (url === '/name') {
            // User can ask server if authentication enabled
            res.setHeader('Content-Type', 'plain/text');
            res.send(this.namespace);
        } else if (url === '/auth') {
            // User can ask server if authentication enabled
            res.setHeader('Content-Type', 'application/json');
            res.json({ auth: this.config.auth });
        } else if (this.config.auth && (!url || url === '/' || url === '/login.html' || url === '/login')) {
            res.setHeader('Content-Type', 'text/html');
            res.send(readFileSync(`${__dirname}/../public/index.html`));
        } else if (url === '/manifest.json') {
            res.setHeader('Content-Type', 'application/json');
            res.send(readFileSync(`${__dirname}/../public/manifest.json`));
        } else if (url === '/favicon.ico') {
            res.setHeader('Content-Type', 'image/x-icon');
            res.send(readFileSync(`${__dirname}/../public/favicon.ico`));
        } else if (url?.includes('socket.io.js')) {
            res.setHeader('Content-Type', 'application/javascript');
            res.send(this.socketIoFile);
        } else {
            next();
        }
    };

    initWebServer(): void {
        this.config.port = parseInt(this.config.port as string, 10) || 0;

        if (this.config.port) {
            if (this.config.secure && !this.certificates) {
                return;
            }

            this.config.ttl = this.config.ttl || 3600;

            if (this.config.auth) {
                const AdapterStore = commonTools.session(session, this.config.ttl);
                // Authentication checked by server itself
                this.store = new AdapterStore({ adapter: this });
            }

            this.getPort(
                this.config.port,
                !this.config.bind || this.config.bind === '0.0.0.0' ? undefined : this.config.bind || undefined,
                async (port: number): Promise<void> => {
                    if (parseInt(port as unknown as string, 10) !== this.config.port) {
                        this.log.error(`port ${this.config.port} already in use`);
                        return this.terminate
                            ? this.terminate(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION)
                            : process.exit(EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
                    }

                    this.server.app = express();

                    // Detect user
                    this.server.app.use(this.detectUser);
                    // Deliver example and socket.io.js file
                    this.server.app.use(this.serveStaticFile);

                    try {
                        const webserver = new WebServer({
                            adapter: this,
                            secure: this.config.secure,
                            app: this.server.app,
                        });

                        this.server.server = await webserver.init();

                        if (this.config.auth) {
                            this.server.app.use(cookieParser());
                            this.server.app.use(bodyParser.urlencoded({ extended: true }));
                            this.server.app.use(bodyParser.json());

                            // Activate OAuth2 server
                            createOAuth2Server(this, {
                                app: this.server.app,
                                secure: this.config.secure,
                                accessLifetime: parseInt(this.config.ttl as string, 10) || 3600,
                                refreshLifetime: 60 * 60 * 24 * 7, // 1 week (Maybe adjustable?)
                                loginPage: '/login',
                            });
                        }
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

                    this.server.app.use((req: Request, res: Response): void => {
                        res.status(404);
                        res.send('Not found');
                    });

                    let serverListening = false;
                    this.server.server.on('error', e => {
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
                    this.server.server.listen(
                        this.config.port,
                        !this.config.bind || this.config.bind === '0.0.0.0' ? undefined : this.config.bind || undefined,
                        () => {
                            void this.setState('info.connection', true, true);
                            serverListening = true;
                        },
                    );

                    const settings: SocketSettings = {
                        ttl: this.config.ttl as number,
                        port: this.config.port,
                        secure: this.config.secure,
                        auth: this.config.auth,
                        crossDomain: true,
                        forceWebSockets: true, // this is irrelevant for ws
                        defaultUser: this.config.defaultUser,
                        language: this.config.language,
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
        if (this.config.auth) {
            const systemConfig = await this.getForeignObjectAsync('system.config');
            // Generate secret for session manager
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

        if (this.config.secure) {
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
