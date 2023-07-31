const ws = require('@iobroker/ws-server');
const SocketCommon = require('@iobroker/socket-classes').SocketCommon;
const SocketWS = require('./socketWS');

class Socket {
    constructor(server, settings, adapter, ignore, store, checkUser) {
        this.ioServer = new SocketWS(settings, adapter);
        this.ioServer.start(server, ws, {userKey: 'connect.sid', checkUser, store, secret: settings.secret});
    }

    getWhiteListIpForAddress(remoteIp, whiteListSettings) {
        return SocketCommon.getWhiteListIpForAddress(remoteIp, whiteListSettings);
    }

    publishAll(type, id, obj) {
        return this.ioServer.publishAll(type, id, obj);
    }

    publishFileAll(id, fileName, size) {
        return this.ioServer.publishFileAll(id, fileName, size);
    }

    publishInstanceMessageAll(sourceInstance, messageType, sid, data) {
        return this.ioServer.publishInstanceMessageAll(sourceInstance, messageType, sid, data);
    }

    sendLog(obj) {
        this.ioServer.sendLog(obj);
    }

    close() {
        this.ioServer.close();
        this.ioServer = null;
    }
}

module.exports = Socket;
