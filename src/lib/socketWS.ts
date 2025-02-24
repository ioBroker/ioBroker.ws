import {
    SocketCommon,
    passportSocket,
    type PassportHttpRequest,
    type Store,
    type SocketSubscribeTypes,
} from '@iobroker/socket-classes';
import type { Socket as WebSocketClient } from '@iobroker/ws-server';
import passport from 'passport';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';
import type { WsAdapterConfig } from '../types';

interface InternalStorageToken {
    token: string;
    exp: number;
    user: string;
}

// From settings used only secure, auth and crossDomain
export class SocketWS extends SocketCommon {
    __getIsNoDisconnect(): boolean {
        return true;
    }

    #onAuthorizeSuccess = (data: PassportHttpRequest, accept: (err: boolean) => void): void => {
        this.adapter.log.debug(
            `successful connection to socket.io from ${(data.socket || data.connection).remoteAddress}`,
        );
        // no error
        accept(false);
    };

    #onAuthorizeFail = (
        data: PassportHttpRequest,
        message: string,
        critical: boolean,
        accept: (err: boolean) => void,
    ): void => {
        setTimeout(() => data.socket.emit(SocketCommon.COMMAND_RE_AUTHENTICATE), 100);

        if (critical) {
            this.adapter?.log.info(
                `failed connection to socket.io from ${(data.socket || data.connection).remoteAddress}: ${message}`,
            );
        }

        // this error will be sent to the user as a special error-package
        // see: http://socket.io/docs/client-api/#socket > error-object
        if (critical) {
            // @ts-expect-error
            accept(new Error(message));
        } else {
            // @ts-expect-error
            accept(new Error(`failed connection to socket.io: ${message}`));
        }
    };

    __initAuthentication(authOptions: {
        store: Store;
        secret?: string;
        oauth2Only?: boolean;
        checkUser?: (
            user: string,
            pass: string,
            cb: (
                error: Error | null,
                result?: {
                    logged_in: boolean;
                    user?: string;
                },
            ) => void,
        ) => void;
    }): void {
        if (authOptions.store && !this.store) {
            this.store = authOptions.store;
        } else if (!authOptions.store && this.store) {
            authOptions.store = this.store;
        }

        if (!authOptions.oauth2Only) {
            this.server?.use(
                passportSocket({
                    passport,
                    cookieParser,
                    checkUser: authOptions.checkUser,
                    secret: authOptions.secret, // the session_secret to parse the cookie
                    store: authOptions.store, // we NEED to use a sessionstore. no memorystore, please
                    success: this.#onAuthorizeSuccess, // *optional* callback on success - read more below
                    fail: this.#onAuthorizeFail, // *optional* callback on fail/error - read more below
                }),
            );
        }
    }

    // Extract username from socket
    __getUserFromSocket(
        socket: WebSocketClient,
        callback: (error: string | null, user?: string, expirationTime?: number) => void,
    ): void {
        let wait = false;
        if (typeof callback !== 'function') {
            return;
        }

        let user: string | undefined;
        let pass: string | undefined;

        if (socket.conn.request.headers?.authorization?.startsWith('Basic ')) {
            const auth = Buffer.from(socket.conn.request.headers.authorization.split(' ')[1], 'base64').toString(
                'utf8',
            );
            const parts = auth.split(':');
            user = parts.shift();
            pass = parts.join(':');
        } else {
            user = socket.query.user as string;
            pass = socket.query.pass as string;
        }

        if (user && typeof user === 'string' && pass && typeof pass === 'string') {
            wait = true;
            void this.adapter.checkPassword(user, pass, res => {
                if (res) {
                    this.adapter.log.debug(`Logged in: ${user}`);
                    if (typeof callback === 'function') {
                        callback(null, user, 0);
                    } else {
                        this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                    }
                } else {
                    this.adapter.log.warn(`Invalid password or user name: ${user}, ${pass[0]}***(${pass.length})`);
                    if (typeof callback === 'function') {
                        callback('unknown user');
                    } else {
                        this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                    }
                }
            });
        } else {
            let accessToken: string | undefined;
            if (socket.conn.request.headers?.cookie) {
                const cookies: string[] = socket.conn.request.headers.cookie.split(';');
                accessToken = cookies.find(cookie => cookie.split('=')[0] === 'access_token');
                if (accessToken) {
                    accessToken = accessToken.split('=')[1];
                }
            }
            if (!accessToken && socket.conn.request.query?.token) {
                accessToken = socket.conn.request.query.token as string;
            } else if (!accessToken && socket.conn.request.headers?.authorization?.startsWith('Bearer ')) {
                accessToken = socket.conn.request.headers.authorization.split(' ')[1];
            }

            if (accessToken) {
                void this.adapter.getSession(`a:${accessToken}`, (obj: InternalStorageToken | undefined): void => {
                    if (!obj?.user) {
                        if (socket._acl) {
                            socket._acl.user = '';
                        }
                        socket.emit(SocketCommon.COMMAND_RE_AUTHENTICATE);
                        callback('Cannot detect user');
                    } else {
                        callback(null, obj.user ? `system.user.${obj.user}` : '', obj.exp);
                    }
                });
                wait = true;
            }

            try {
                if (!wait && socket.conn.request.sessionID) {
                    socket._sessionID = socket.conn.request.sessionID;
                    if (this.store) {
                        wait = true;
                        this.store.get(socket.conn.request.sessionID, (_err, obj) => {
                            if (obj?.passport?.user) {
                                callback(
                                    null,
                                    obj.passport.user ? `system.user.${obj.passport.user}` : '',
                                    obj.cookie.expires ? new Date(obj.cookie.expires).getTime() : 0,
                                );
                            }
                        });
                    }
                }
            } catch {
                // ignore
            }
        }

        if (!wait) {
            callback('Cannot detect user');
        }
    }

    __getClientAddress(socket: WebSocketClient): AddressInfo {
        let address;
        if (socket.connection) {
            address = socket.connection && socket.connection.remoteAddress;
        } else {
            // @ts-expect-error socket.io
            address = socket.ws._socket.remoteAddress;
        }

        // @ts-expect-error socket.io
        if (!address && socket.handshake) {
            // @ts-expect-error socket.io
            address = socket.handshake.address;
        }
        // @ts-expect-error socket.io
        if (!address && socket.conn.request?.connection) {
            // @ts-expect-error socket.io
            address = socket.conn.request.connection.remoteAddress;
        }

        if (address && typeof address !== 'object') {
            return {
                address,
                family: address.includes(':') ? 'IPv6' : 'IPv4',
                port: 0,
            };
        }

        return address;
    }

    #waitForSessionEnd(socket: WebSocketClient): void {
        if (socket._sessionTimer) {
            clearTimeout(socket._sessionTimer);
            socket._sessionTimer = undefined;
        }
        const sessionId = socket._sessionID;
        if (sessionId) {
            this.store?.get(
                sessionId,
                (
                    _err: Error | null,
                    obj?: {
                        cookie: {
                            originalMaxAge: number;
                            expires: string;
                            httpOnly: boolean;
                            path: string;
                        };
                        passport: {
                            user: string;
                        };
                    },
                ) => {
                    if (obj) {
                        const expires = new Date(obj.cookie.expires);
                        const interval = expires.getTime() - Date.now();
                        if (interval > 0) {
                            socket._sessionTimer ||= setTimeout(
                                () => this.#waitForSessionEnd(socket),
                                interval > 3600000 ? 3600000 : interval,
                            );
                            socket.emit('expire', expires.getTime());
                        } else {
                            this.adapter.log.warn('REAUTHENTICATE!');
                            socket.emit(SocketCommon.COMMAND_RE_AUTHENTICATE);
                        }
                    } else {
                        this.adapter.log.warn('REAUTHENTICATE!');
                        socket?.emit?.(SocketCommon.COMMAND_RE_AUTHENTICATE);
                    }
                },
            );
        } else {
            socket?.emit?.(SocketCommon.COMMAND_RE_AUTHENTICATE);
        }
    }

    // update session ID, but not ofter than 60 seconds
    __updateSession(socket: WebSocketClient): boolean {
        const now = Date.now();
        if (socket._sessionExpiresAt) {
            // If less than 10 seconds, then recheck the socket
            if (socket._sessionExpiresAt < Date.now() - 10_000) {
                let accessToken = socket.conn.request.headers?.cookie
                    ?.split(';')
                    .find(c => c.trim().startsWith('access_token='));

                if (accessToken) {
                    accessToken = accessToken.split('=')[1];
                } else {
                    // Try to find in a query
                    accessToken = socket.conn.request.query?.token as string;
                    if (!accessToken && socket.conn.request.headers?.authorization?.startsWith('Bearer ')) {
                        // Try to find in Authentication header
                        accessToken = socket.conn.request.headers.authorization.split(' ')[1];
                    }
                }

                if (accessToken) {
                    const tokenStr = accessToken.split('=')[1];
                    void this.store?.get(`a:${tokenStr}`, (err: Error, token: any): void => {
                        const tokenData = token as InternalStorageToken;
                        if (err) {
                            this.adapter.log.error(`Cannot get token: ${err}`);
                        } else if (!tokenData?.user) {
                            this.adapter.log.error('No session found');
                        } else {
                            socket._sessionExpiresAt = tokenData.exp;
                        }
                    });
                }
            }

            // Check socket expiration time
            return socket._sessionExpiresAt > now;
        }

        const sessionId = socket._sessionID;

        if (sessionId && (!socket._lastActivity || now - socket._lastActivity > 10000)) {
            socket._lastActivity = now;
            this.store?.get(
                sessionId,
                (
                    _err: Error | null,
                    obj?: {
                        cookie: {
                            originalMaxAge: number;
                            expires: string;
                            httpOnly: boolean;
                            path: string;
                        };
                        passport: {
                            user: string;
                        };
                    },
                ): void => {
                    // obj = {"cookie":{"originalMaxAge":2592000000,"expires":"2020-09-24T18:09:50.377Z","httpOnly":true,"path":"/"},"passport":{"user":"admin"}}
                    if (obj) {
                        // start timer
                        if (!socket._sessionTimer) {
                            this.#waitForSessionEnd(socket);
                        }
                    } else {
                        this.adapter.log.warn('REAUTHENTICATE!');
                        socket.emit(SocketCommon.COMMAND_RE_AUTHENTICATE);
                    }
                },
            );
        }
        return true;
    }

    __getSessionID(socket: WebSocketClient): string | null {
        return (this.adapter.config as WsAdapterConfig).auth ? socket._sessionID || null : null;
    }

    publishAll(type: SocketSubscribeTypes, id: string, obj: ioBroker.Object | ioBroker.State | null | undefined): void {
        if (id === undefined) {
            console.log('Problem');
        }

        this.server?.sockets?.connected.forEach(socket => this.publish(socket, type, id, obj));
    }

    publishFileAll(id: string, fileName: string, size: number | null): void {
        if (id === undefined) {
            console.log('Problem');
        }

        if (this.server?.sockets) {
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;

            for (const socket of sockets) {
                if (this.publishFile(socket, id, fileName, size)) {
                    this.__updateSession(socket);
                }
            }
        }
    }

    publishInstanceMessageAll(sourceInstance: string, messageType: string, sid: string, data: any): void {
        if (this.server?.sockets) {
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;

            // this could be an object or array
            for (const socket of sockets) {
                if (socket.id === sid) {
                    if (this.publishInstanceMessage(socket, sourceInstance, messageType, data)) {
                        this.__updateSession(socket);
                    }
                }
            }
        }
    }
}
