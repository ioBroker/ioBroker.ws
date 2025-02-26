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
import type { WsAdapterConfig } from '../types';

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
