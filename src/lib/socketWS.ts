import { SocketCommon, passportSocket, type PassportHttpRequest, type Store } from '@iobroker/socket-classes';
import type { Socket as WebSocketClient } from '@iobroker/ws-server';
import passport from 'passport';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';
import type { WsAdapterConfig } from '../types';
import type { SocketSubscribeTypes } from '@iobroker/socket-classes/dist/types';

// From settings used only secure, auth and crossDomain
export class SocketWS extends SocketCommon {
    __getIsNoDisconnect(): boolean {
        return true;
    }

    #onAuthorizeSuccess = (data: PassportHttpRequest, accept: (err: boolean) => void): void => {
        this.adapter.log.debug(
            `successful connection to socket.io from ${(data.socket || data.connection).remoteAddress}`,
        );
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
            accept(new Error(`failed connection to socket.io: ${message}`)); //null, false);
        }
    };

    __initAuthentication(authOptions: {
        store: Store;
        secret: string;
        checkUser?: (
            user: string,
            pass: string,
            cb: (
                error: Error | null,
                result?: {
                    logged_in: boolean;
                },
            ) => void,
        ) => void;
    }): void {
        if (authOptions.store && !this.store) {
            this.store = authOptions.store;
        } else if (!authOptions.store && this.store) {
            authOptions.store = this.store;
        }

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

    // Extract username from socket
    __getUserFromSocket(socket: WebSocketClient, callback: (error: string | null, user?: string) => void): void {
        let wait = false;
        if (typeof callback !== 'function') {
            return;
        }

        const user = socket.query.user;
        const pass = socket.query.pass;
        if (user && typeof user === 'string' && pass && typeof pass === 'string') {
            wait = true;
            void this.adapter.checkPassword(user, pass, res => {
                if (res) {
                    this.adapter.log.debug(`Logged in: ${user}`);
                    if (typeof callback === 'function') {
                        callback(null, user);
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
            try {
                if (socket.conn.request.sessionID) {
                    socket._sessionID = socket.conn.request.sessionID;
                    if (this.store) {
                        wait = true;
                        this.store.get(socket.conn.request.sessionID, (_err, obj) => {
                            if (obj?.passport?.user) {
                                callback(null, obj.passport.user ? `system.user.${obj.passport.user}` : '');
                            }
                        });
                    }
                }
            } catch {
                // ignore
            }
        }

        !wait && callback('Cannot detect user');
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
                    obj: {
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
        const sessionId = socket._sessionID;
        const now = Date.now();
        if (sessionId && (!socket._lastActivity || now - socket._lastActivity > 10000)) {
            socket._lastActivity = now;
            this.store?.get(
                sessionId,
                (
                    _err: Error | null,
                    obj: {
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
                        /*obj.ttl = obj.ttl || (new Date(obj.cookie.expires).getTime() - now);
                    const expires = new Date();
                    expires.setMilliseconds(expires.getMilliseconds() + obj.ttl + 10000);
                    obj.cookie.expires = expires.toISOString();
                    console.log('Session ' + sessionId + ' expires on ' + obj.cookie.expires);

                    this.store.set(sessionId, obj);*/
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
