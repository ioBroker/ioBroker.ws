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
        // no error
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
            accept(new Error(`failed connection to socket.io: ${message}`));
        }
    };
    __initAuthentication(authOptions) {
        if (authOptions.store && !this.store) {
            this.store = authOptions.store;
        }
        else if (!authOptions.store && this.store) {
            authOptions.store = this.store;
        }
        if (!authOptions.oauth2Only) {
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