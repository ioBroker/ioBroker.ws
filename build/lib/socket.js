"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Socket = void 0;
const ws_server_1 = require("@iobroker/ws-server");
const socketWS_1 = require("./socketWS");
const socket_classes_1 = require("@iobroker/socket-classes");
class Socket {
    ioServer;
    constructor(server, settings, adapter, store, checkUser) {
        this.ioServer = new socketWS_1.SocketWS(settings, adapter);
        this.ioServer.start(server, ws_server_1.SocketIO, {
            checkUser,
            store,
            secret: settings.secret,
        });
    }
    getWhiteListIpForAddress(remoteIp, whiteListSettings) {
        return socket_classes_1.SocketCommon.getWhiteListIpForAddress(remoteIp, whiteListSettings);
    }
    publishAll(type, id, obj) {
        return this.ioServer?.publishAll(type, id, obj);
    }
    publishFileAll(id, fileName, size) {
        return this.ioServer?.publishFileAll(id, fileName, size);
    }
    publishInstanceMessageAll(sourceInstance, messageType, sid, data) {
        return this.ioServer?.publishInstanceMessageAll(sourceInstance, messageType, sid, data);
    }
    sendLog(obj) {
        this.ioServer?.sendLog(obj);
    }
    close() {
        if (this.ioServer) {
            this.ioServer.close();
            this.ioServer = null;
        }
    }
}
exports.Socket = Socket;
//# sourceMappingURL=socket.js.map