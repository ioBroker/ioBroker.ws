"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketWS = void 0;
const socket_classes_1 = require("@iobroker/socket-classes");
const passport_1 = __importDefault(require("passport"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
// From settings used only secure, auth and crossDomain
class SocketWS extends socket_classes_1.SocketCommon {
    __getIsNoDisconnect() {
        return true;
    }
    #onAuthorizeSuccess = (data, accept) => {
        this.adapter.log.debug(`successful connection to socket.io from ${(data.socket || data.connection).remoteAddress}`);
        accept(false);
    };
    #onAuthorizeFail = (data, message, critical, accept) => {
        setTimeout(() => data.socket.emit(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE), 100);
        if (critical) {
            this.adapter?.log.info(`failed connection to socket.io from ${(data.socket || data.connection).remoteAddress}: ${message}`);
        }
        // this error will be sent to the user as a special error-package
        // see: http://socket.io/docs/client-api/#socket > error-object
        if (critical) {
            // @ts-expect-error
            accept(new Error(message));
        }
        else {
            // @ts-expect-error
            accept(new Error(`failed connection to socket.io: ${message}`)); //null, false);
        }
    };
    __initAuthentication(authOptions) {
        if (authOptions.store && !this.store) {
            this.store = authOptions.store;
        }
        else if (!authOptions.store && this.store) {
            authOptions.store = this.store;
        }
        this.server?.use((0, socket_classes_1.passportSocket)({
            passport: passport_1.default,
            cookieParser: cookie_parser_1.default,
            checkUser: authOptions.checkUser,
            secret: authOptions.secret, // the session_secret to parse the cookie
            store: authOptions.store, // we NEED to use a sessionstore. no memorystore, please
            success: this.#onAuthorizeSuccess, // *optional* callback on success - read more below
            fail: this.#onAuthorizeFail, // *optional* callback on fail/error - read more below
        }));
    }
    // Extract username from socket
    __getUserFromSocket(socket, callback) {
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
                    }
                    else {
                        this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                    }
                }
                else {
                    this.adapter.log.warn(`Invalid password or user name: ${user}, ${pass[0]}***(${pass.length})`);
                    if (typeof callback === 'function') {
                        callback('unknown user');
                    }
                    else {
                        this.adapter.log.warn('[_getUserFromSocket] Invalid callback');
                    }
                }
            });
        }
        else {
            if (socket.conn.request.headers?.cookie) {
                const cookies = socket.conn.request.headers.cookie.split(';');
                const accessSocket = cookies.find(cookie => cookie.split('=')[0] === 'access_token');
                if (accessSocket) {
                    const token = accessSocket.split('=')[1];
                    void this.adapter.getSession(`a:${token}`, (obj) => {
                        if (!obj?.user) {
                            if (socket._acl) {
                                socket._acl.user = '';
                            }
                            socket.emit(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
                            callback('Cannot detect user');
                        }
                        else {
                            callback(null, obj.user ? `system.user.${obj.user}` : '');
                        }
                    });
                    return;
                }
            }
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
            }
            catch {
                // ignore
            }
        }
        !wait && callback('Cannot detect user');
    }
    __getClientAddress(socket) {
        let address;
        if (socket.connection) {
            address = socket.connection && socket.connection.remoteAddress;
        }
        else {
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
    #waitForSessionEnd(socket) {
        if (socket._sessionTimer) {
            clearTimeout(socket._sessionTimer);
            socket._sessionTimer = undefined;
        }
        const sessionId = socket._sessionID;
        if (sessionId) {
            this.store?.get(sessionId, (_err, obj) => {
                if (obj) {
                    const expires = new Date(obj.cookie.expires);
                    const interval = expires.getTime() - Date.now();
                    if (interval > 0) {
                        socket._sessionTimer ||= setTimeout(() => this.#waitForSessionEnd(socket), interval > 3600000 ? 3600000 : interval);
                        socket.emit('expire', expires.getTime());
                    }
                    else {
                        this.adapter.log.warn('REAUTHENTICATE!');
                        socket.emit(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
                    }
                }
                else {
                    this.adapter.log.warn('REAUTHENTICATE!');
                    socket?.emit?.(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
                }
            });
        }
        else {
            socket?.emit?.(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
        }
    }
    // update session ID, but not ofter than 60 seconds
    __updateSession(socket) {
        const sessionId = socket._sessionID;
        const now = Date.now();
        if (sessionId && (!socket._lastActivity || now - socket._lastActivity > 10000)) {
            socket._lastActivity = now;
            this.store?.get(sessionId, (_err, obj) => {
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
                }
                else {
                    this.adapter.log.warn('REAUTHENTICATE!');
                    socket.emit(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
                }
            });
        }
        return true;
    }
    __getSessionID(socket) {
        return this.adapter.config.auth ? socket._sessionID || null : null;
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
        if (this.server?.sockets) {
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;
            for (const socket of sockets) {
                if (this.publishFile(socket, id, fileName, size)) {
                    this.__updateSession(socket);
                }
            }
        }
    }
    publishInstanceMessageAll(sourceInstance, messageType, sid, data) {
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
exports.SocketWS = SocketWS;
//# sourceMappingURL=socketWS.js.map