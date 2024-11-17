import type { Store } from 'express-session';
import { SocketCommon } from '@iobroker/socket-classes';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';

// From settings used only secure, auth and crossDomain
class SocketWS extends SocketCommon {
    protected adapter: ioBroker.Adapter;
    protected server: HttpServer | HttpsServer;
    private passport: any; // require('passport') - only if auth is activated
    private cookieParser: any; // require('cookie-parser') - only if auth is activated
    private passportSocketIo: any; // require('./passportSocket') - only if auth is activated

    __getIsNoDisconnect() {
        return true;
    }

    _onAuthorizeSuccess = (data, accept) => {
        this.adapter.log.debug(`successful connection to socket.io from ${data.connection.remoteAddress}`);
        accept();
    };

    _onAuthorizeFail = (data, message, error, accept) => {
        setTimeout(() => data.socket.emit(SocketCommon.COMMAND_RE_AUTHENTICATE), 100);

        error &&
            this.adapter.log.error(`failed connection to socket.io from ${data.connection.remoteAddress}:`, message);

        if (error) {
            accept(new Error(message));
        } else {
            accept(new Error(`failed connection to socket.io: ${message}`)); //null, false);
        }
        // this error will be sent to the user as a special error-package
        // see: http://socket.io/docs/client-api/#socket > error-object
    };

    async __initAuthentication(authOptions: { store: Store }) {
        passportSocketIo = passportSocketIo || require('@iobroker/socket-classes').passportSocket;
        passport = passport || require('@iobroker/socket-classes').passport;
        cookieParser = cookieParser || require('@iobroker/socket-classes').cookieParser;

        if (authOptions.store && !this.store) {
            this.store = authOptions.store;
        } else if (!authOptions.store && this.store) {
            authOptions.store = this.store;
        }

        this.server.use(
            passportSocketIo.authorize({
                passport,
                cookieParser,
                checkUser: authOptions.checkUser,
                key: authOptions.userKey, // the name of the cookie where express/connect stores its session_id
                secret: authOptions.secret, // the session_secret to parse the cookie
                store: authOptions.store, // we NEED to use a sessionstore. no memorystore please
                success: this._onAuthorizeSuccess, // *optional* callback on success - read more below
                fail: this._onAuthorizeFail, // *optional* callback on fail/error - read more below
            }),
        );
    }

    // Extract username from socket
    __getUserFromSocket(socket, callback) {
        let wait = false;
        if (typeof callback !== 'function') {
            return;
        }

        const user = socket.query.user;
        const pass = socket.query.pass;
        if (user && pass) {
            wait = true;
            this.adapter.checkPassword(user, pass, res => {
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
                        this.store.get(socket.conn.request.sessionID, (err, obj) => {
                            if (obj && obj.passport && obj.passport.user) {
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

    __getClientAddress(socket) {
        let address;
        if (socket.connection) {
            address = socket.connection && socket.connection.remoteAddress;
        } else {
            address = socket.ws._socket.remoteAddress;
        }

        if (!address && socket.handshake) {
            address = socket.handshake.address;
        }
        if (!address && socket.conn.request && socket.conn.request.connection) {
            address = socket.conn.request.connection.remoteAddress;
        }
        return address;
    }

    _waitForSessionEnd(socket) {
        if (socket._sessionTimer) {
            clearTimeout(socket._sessionTimer);
            socket._sessionTimer = null;
        }
        const sessionId = socket._sessionID;
        this.store &&
            this.store.get(sessionId, (err, obj) => {
                if (obj) {
                    const expires = new Date(obj.cookie.expires);
                    const interval = expires.getTime() - Date.now();
                    if (interval > 0) {
                        socket._sessionTimer =
                            socket._sessionTimer ||
                            setTimeout(() => this._waitForSessionEnd(socket), interval > 3600000 ? 3600000 : interval);
                        socket.emit('expire', expires.getTime());
                    } else {
                        this.adapter.log.warn('REAUTHENTICATE!');
                        socket.emit(SocketCommon.COMMAND_RE_AUTHENTICATE);
                    }
                } else {
                    this.adapter.log.warn('REAUTHENTICATE!');
                    socket && socket.emit && socket.emit(SocketCommon.COMMAND_RE_AUTHENTICATE);
                }
            });
    }

    // update session ID, but not ofter than 60 seconds
    __updateSession(socket) {
        const sessionId = socket._sessionID;
        const now = Date.now();
        if (sessionId && (!socket._lastUpdate || now - socket._lastUpdate > 10000)) {
            socket._lastUpdate = now;
            this.store?.get(sessionId, (err, obj) => {
                // obj = {"cookie":{"originalMaxAge":2592000000,"expires":"2020-09-24T18:09:50.377Z","httpOnly":true,"path":"/"},"passport":{"user":"admin"}}
                if (obj) {
                    // start timer
                    !socket._sessionTimer && this._waitForSessionEnd(socket);
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
            });
        }
        return true;
    }

    __getSessionID(socket) {
        return this.adapter.config.auth && socket._sessionID;
    }

    publishAll(type, id, obj) {
        if (id === undefined) {
            console.log('Problem');
        }

        this.server?.sockets?.connected.forEach(socket => this.publish(socket, type, id, obj));
    }

    publishFileAll(id, fileName, size) {
        if (id === undefined) {
            console.log('Problem');
        }

        if (this.server && this.server.sockets) {
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;

            // this could be an object or array
            Object.keys(sockets).forEach(i => {
                if (this.publishFile(sockets[i], id, fileName, size)) {
                    this.__updateSession(sockets[i]);
                }
            });
        }
    }

    publishInstanceMessageAll(sourceInstance, messageType, sid, data) {
        if (this.server && this.server.sockets) {
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;

            // this could be an object or array
            Object.keys(sockets).forEach(i => {
                if (sockets[i].id === sid) {
                    if (this.publishInstanceMessage(sockets[i], sourceInstance, messageType, data)) {
                        this.__updateSession(sockets[i]);
                    }
                }
            });
        }
    }
}

module.exports = SocketWS;
