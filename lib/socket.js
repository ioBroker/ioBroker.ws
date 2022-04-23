const socketio = require('iobroker.ws.server');
const IOSocket = require('./socketCommon');

// From settings used only secure, auth and crossDomain
class WSSocket extends IOSocket {
    getIsNoDisconnect() {
        return true;
    }

    getSocket() {
        return socketio;
    }

    initAuthentication(options) {
        const passportSocketIo = require('./passportSocket');

        this.onAuthorizeSuccess = (data, accept) => {
            this.adapter.log.debug(`successful connection to socket.io from ${data.connection.remoteAddress}`);
            accept();
        }

        this.onAuthorizeFail = (data, message, error, accept) => {
            setTimeout(() => data.socket.emit(IOSocket.COMMAND_RE_AUTHENTICATE), 100);

            error && this.adapter.log.error(`failed connection to socket.io from ${data.connection.remoteAddress}:`, message);

            if (error) {
                accept(new Error(message));
            } else {
                accept(new Error(`failed connection to socket.io: ${message}`));//null, false);
            }
            // this error will be sent to the user as a special error-package
            // see: http://socket.io/docs/client-api/#socket > error-object
        }

        this.server.use(passportSocketIo.authorize({
            checkUser:    options.checkUser,
            passport:     require('passport'),
            cookieParser: this._cookieParser,
            key:          options.userKey,             // the name of the cookie where express/connect stores its session_id
            secret:       this.settings.secret,     // the session_secret to parse the cookie
            store:        this._store,              // we NEED to use a sessionstore. no memorystore please
            success:      this.onAuthorizeSuccess,  // *optional* callback on success - read more below
            fail:         this.onAuthorizeFail      // *optional* callback on fail/error - read more below
        }));
    }

    // Extract username from socket
    _getUserFromSocket(socket, callback) {
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
                    this.adapter.log.debug('Logged in: ' + user);
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
                    if (this._store) {
                        wait = true;
                        this._store.get(socket.conn.request.sessionID, (err, obj) => {
                            if (obj && obj.passport && obj.passport.user) {
                                callback(null, obj.passport.user ? 'system.user.' + obj.passport.user : '');
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

    getClientAddress(socket) {
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

    waitForSessionEnd(socket) {
        if (socket._sessionTimer) {
            clearTimeout(socket._sessionTimer);
            socket._sessionTimer = null;
        }
        const sessionId = socket._sessionID;
        this._store && this._store.get(sessionId, (err, obj) => {
            if (obj) {
                const expires = new Date(obj.cookie.expires);
                const interval = expires.getTime() - Date.now();
                if (interval > 0) {
                    socket._sessionTimer = socket._sessionTimer || setTimeout(() => this.waitForSessionEnd(socket), interval > 3600000 ? 3600000 : interval);
                    socket.emit('expire', expires.getTime());
                } else {
                    this.adapter.log.warn('REAUTHENTICATE!');
                    socket.emit(IOSocket.COMMAND_RE_AUTHENTICATE);
                }
            } else {
                this.adapter.log.warn('REAUTHENTICATE!');
                socket && socket.emit && socket.emit(IOSocket.COMMAND_RE_AUTHENTICATE);
            }
        });
    }

    // update session ID, but not ofter than 60 seconds
    updateSession(socket) {
        const sessionId = socket._sessionID;
        const now = Date.now();
        if (sessionId && (!socket._lastUpdate || now - socket._lastUpdate > 10000)) {
            socket._lastUpdate = now;
            this._store && this._store.get(sessionId, (err, obj) => {
                // obj = {"cookie":{"originalMaxAge":2592000000,"expires":"2020-09-24T18:09:50.377Z","httpOnly":true,"path":"/"},"passport":{"user":"admin"}}
                if (obj) {
                    // start timer
                    !socket._sessionTimer && this.waitForSessionEnd(socket);
                    /*obj.ttl = obj.ttl || (new Date(obj.cookie.expires).getTime() - now);
                    const expires = new Date();
                    expires.setMilliseconds(expires.getMilliseconds() + obj.ttl + 10000);
                    obj.cookie.expires = expires.toISOString();
                    console.log('Session ' + sessionId + ' expires on ' + obj.cookie.expires);

                    this._store.set(sessionId, obj);*/
                } else {
                    this.adapter.log.warn('REAUTHENTICATE!');
                    socket.emit(IOSocket.COMMAND_RE_AUTHENTICATE);
                }
            });
        }
        return true;
    }

    getSessionID(socket) {
        return this.adapter.config.auth && socket._sessionID;
    }
}

module.exports = WSSocket;
