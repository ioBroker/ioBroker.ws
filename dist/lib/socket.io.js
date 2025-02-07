"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
const MESSAGE_TYPES = {
  MESSAGE: 0,
  PING: 1,
  PONG: 2,
  CALLBACK: 3
};
const DEBUG = true;
const ERRORS = {
  1e3: "CLOSE_NORMAL",
  1001: "CLOSE_GOING_AWAY",
  1002: "CLOSE_PROTOCOL_ERROR",
  1003: "CLOSE_UNSUPPORTED",
  1005: "CLOSED_NO_STATUS",
  1006: "CLOSE_ABNORMAL",
  1007: "Unsupported payload",
  1008: "Policy violation",
  1009: "CLOSE_TOO_LARGE",
  1010: "Mandatory extension",
  1011: "Server error",
  1012: "Service restart",
  1013: "Try again later",
  1014: "Bad gateway	Server",
  1015: "TLS handshake fail"
};
class SocketClient {
  constructor() {
    __publicField(this, "connectHandlers", []);
    __publicField(this, "reconnectHandlers", []);
    __publicField(this, "disconnectHandlers", []);
    __publicField(this, "errorHandlers", []);
    __publicField(this, "handlers", {});
    __publicField(this, "wasConnected", false);
    __publicField(this, "connectTimer", null);
    __publicField(this, "connectingTimer", null);
    __publicField(this, "connectionCount", 0);
    __publicField(this, "callbacks", []);
    __publicField(this, "pending", []);
    __publicField(this, "id", 0);
    __publicField(this, "lastPong", 0);
    __publicField(this, "socket", null);
    __publicField(this, "url", "");
    __publicField(this, "options", null);
    __publicField(this, "pingInterval", null);
    __publicField(this, "sessionID", 0);
    __publicField(this, "authTimeout", null);
    __publicField(this, "connected", false);
    __publicField(this, "log");
    __publicField(this, "emit", (name, ...args) => {
      if (!this.socket || !this.connected) {
        if (!this.wasConnected) {
          this.pending.push({ name, args });
        } else {
          this.log.warn("Not connected");
        }
        return;
      }
      this.id++;
      if (name === "writeFile" && args && typeof args[2] !== "string" && args[2]) {
        let binary = "";
        const bytes = new Uint8Array(args[2]);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        args[2] = window.btoa(binary);
      }
      try {
        if (args && typeof args[args.length - 1] === "function") {
          const _args = [...args];
          const eventHandler = _args.pop();
          this.withCallback(name, this.id, _args, eventHandler);
        } else if (!(args == null ? void 0 : args.length)) {
          this.socket.send(JSON.stringify([MESSAGE_TYPES.MESSAGE, this.id, name]));
        } else {
          this.socket.send(JSON.stringify([MESSAGE_TYPES.MESSAGE, this.id, name, args]));
        }
      } catch (e) {
        console.error(`Cannot send: ${e}`);
        this.close();
      }
    });
    __publicField(this, "disconnect", this.close);
    this.log = {
      debug: (text) => DEBUG && console.log(`[${new Date().toISOString()}] ${text}`),
      warn: (text) => console.warn(`[${new Date().toISOString()}] ${text}`),
      error: (text) => console.error(`[${new Date().toISOString()}] ${text}`)
    };
  }
  static getQuery(_url) {
    const query = _url.split("?")[1] || "";
    const parts = query.split("&");
    const result = {};
    for (let p = 0; p < parts.length; p++) {
      const parts1 = parts[p].split("=");
      result[parts1[0]] = decodeURIComponent(parts[1]);
    }
    return result;
  }
  connect(url, options) {
    var _a, _b;
    this.log.debug("Try to connect");
    if (url) {
      url = url.split("#")[0];
    }
    this.id = 0;
    this.connectTimer && clearInterval(this.connectTimer);
    this.connectTimer = null;
    this.url = this.url || url || window.location.href;
    this.options = this.options || JSON.parse(JSON.stringify(options || {}));
    if (!this.options) {
      throw new Error("No options provided!");
    }
    this.options.pongTimeout = parseInt(this.options.pongTimeout, 10) || 6e4;
    this.options.pingInterval = parseInt(this.options.pingInterval, 10) || 5e3;
    this.options.connectTimeout = parseInt(this.options.connectTimeout, 10) || 3e3;
    this.options.authTimeout = parseInt(this.options.authTimeout, 10) || 3e3;
    this.options.connectInterval = parseInt(this.options.connectInterval, 10) || 1e3;
    this.options.connectMaxAttempt = parseInt(this.options.connectMaxAttempt, 10) || 5;
    this.sessionID = Date.now();
    try {
      if (this.url === "/") {
        let parts = window.location.pathname.split("/");
        if (window.location.pathname.endsWith(".html") || window.location.pathname.endsWith(".htm")) {
          parts.pop();
        }
        this.url = `${window.location.protocol}//${window.location.host}/${parts.join("/")}`;
      }
      const query = SocketClient.getQuery(this.url);
      if (query.sid) {
        delete query.sid;
      }
      if (query.hasOwnProperty("")) {
        delete query[""];
      }
      let u = `${this.url.replace(/^http/, "ws").split("?")[0]}?sid=${this.sessionID}`;
      if (Object.keys(query).length) {
        u += `&${Object.keys(query).map((attr) => query[attr] === void 0 ? attr : `${attr}=${query[attr]}`).join("&")}`;
      }
      if (((_a = this.options) == null ? void 0 : _a.name) && !query.name) {
        u += `&name=${encodeURIComponent(this.options.name)}`;
      }
      this.socket = new WebSocket(u);
    } catch (error) {
      (_b = this.handlers.error) == null ? void 0 : _b.forEach((cb) => cb.call(this, error));
      this.close();
      return this;
    }
    this.connectingTimer = setTimeout(() => {
      this.connectingTimer = null;
      this.log.warn("No READY flag received in 3 seconds. Re-init");
      this.close();
    }, this.options.connectTimeout);
    this.socket.onopen = () => {
      var _a2;
      this.lastPong = Date.now();
      this.connectionCount = 0;
      this.pingInterval = setInterval(() => {
        var _a3, _b2, _c;
        if (!this.options) {
          throw new Error("No options provided!");
        }
        if (Date.now() - this.lastPong > (((_a3 = this.options) == null ? void 0 : _a3.pingInterval) || 5e3) - 10) {
          try {
            (_b2 = this.socket) == null ? void 0 : _b2.send(JSON.stringify([MESSAGE_TYPES.PING]));
          } catch (e) {
            this.log.warn(`Cannot send ping. Close connection: ${e}`);
            this.close();
            this._garbageCollect();
            return;
          }
        }
        if (Date.now() - this.lastPong > (((_c = this.options) == null ? void 0 : _c.pongTimeout) || 6e4)) {
          this.close();
        }
        this._garbageCollect();
      }, ((_a2 = this.options) == null ? void 0 : _a2.pingInterval) || 5e3);
    };
    this.socket.onclose = (event) => {
      if (event.code === 3001) {
        this.log.warn("ws closed");
      } else {
        this.log.error(`ws connection error: ${ERRORS[event.code]}`);
      }
      this.close();
    };
    this.socket.onerror = (error) => {
      if (this.connected && this.socket) {
        if (this.socket.readyState === 1) {
          this.log.error(`ws normal error: ${error.type}`);
        }
        this.errorHandlers.forEach((cb) => cb.call(this, ERRORS[error.code] || "UNKNOWN"));
      }
      this.close();
    };
    this.socket.onmessage = (message) => {
      var _a2, _b2;
      this.lastPong = Date.now();
      if (!(message == null ? void 0 : message.data) || typeof message.data !== "string") {
        console.error(`Received invalid message: ${JSON.stringify(message)}`);
        return;
      }
      let data;
      try {
        data = JSON.parse(message.data);
      } catch (e) {
        console.error(`Received invalid message: ${JSON.stringify(message.data)}`);
        return;
      }
      const type = data[0];
      const id = data[1];
      const name = data[2];
      const args = data[3];
      if (this.authTimeout) {
        clearTimeout(this.authTimeout);
        this.authTimeout = null;
      }
      if (type === MESSAGE_TYPES.CALLBACK) {
        this.findAnswer(id, args);
      } else if (type === MESSAGE_TYPES.MESSAGE) {
        if (name === "___ready___") {
          this.connected = true;
          if (this.wasConnected) {
            this.reconnectHandlers.forEach((cb) => cb.call(this, true));
          } else {
            this.connectHandlers.forEach((cb) => cb.call(this, true));
            this.wasConnected = true;
          }
          this.connectingTimer && clearTimeout(this.connectingTimer);
          this.connectingTimer = null;
          if (this.pending.length) {
            this.pending.forEach(({ name: name2, args: args2 }) => this.emit(name2, ...args2));
            this.pending = [];
          }
        } else if (args) {
          (_a2 = this.handlers[name]) == null ? void 0 : _a2.forEach((cb) => cb.apply(this, args));
        } else {
          (_b2 = this.handlers[name]) == null ? void 0 : _b2.forEach((cb) => cb.call(this));
        }
      } else if (type === MESSAGE_TYPES.PING) {
        if (this.socket) {
          this.socket.send(JSON.stringify([MESSAGE_TYPES.PONG]));
        } else {
          this.log.warn("Cannot do pong: connection closed");
        }
      } else if (type === MESSAGE_TYPES.PONG) {
      } else {
        this.log.warn(`Received unknown message type: ${type}`);
      }
    };
    return this;
  }
  _garbageCollect() {
    const now = Date.now();
    let empty = 0;
    if (!DEBUG) {
      for (let i = 0; i < this.callbacks.length; i++) {
        const callback = this.callbacks[i];
        if (callback) {
          if (callback.ts > now) {
            const cb = callback.cb;
            setTimeout(cb, 0, "timeout");
            this.callbacks[i] = null;
            empty++;
          }
        } else {
          empty++;
        }
      }
    }
    if (empty > this.callbacks.length / 2) {
      const newCallback = [];
      for (let i = 0; i < this.callbacks.length; i++) {
        this.callbacks[i] && newCallback.push(this.callbacks[i]);
      }
      this.callbacks = newCallback;
    }
  }
  withCallback(name, id, args, cb) {
    var _a, _b;
    if (name === "authenticate") {
      this.authTimeout = setTimeout(() => {
        var _a2;
        this.authTimeout = null;
        if (this.connected) {
          this.log.debug("Authenticate timeout");
          (_a2 = this.handlers.error) == null ? void 0 : _a2.forEach((cb2) => cb2.call(this, "Authenticate timeout"));
        }
        this.close();
      }, ((_a = this.options) == null ? void 0 : _a.authTimeout) || 3e3);
    }
    this.callbacks.push({ id, cb, ts: DEBUG ? 0 : Date.now() + 3e4 });
    (_b = this.socket) == null ? void 0 : _b.send(JSON.stringify([MESSAGE_TYPES.CALLBACK, id, name, args]));
  }
  findAnswer(id, args) {
    for (let i = 0; i < this.callbacks.length; i++) {
      const callback = this.callbacks[i];
      if ((callback == null ? void 0 : callback.id) === id) {
        const cb = callback.cb;
        cb.apply(null, args);
        this.callbacks[i] = null;
      }
    }
  }
  on(name, cb) {
    if (cb) {
      if (name === "connect") {
        this.connectHandlers.push(cb);
      } else if (name === "disconnect") {
        this.disconnectHandlers.push(cb);
      } else if (name === "reconnect") {
        this.reconnectHandlers.push(cb);
      } else if (name === "error") {
        this.errorHandlers.push(cb);
      } else {
        this.handlers[name] = this.handlers[name] || [];
        this.handlers[name].push(cb);
      }
    }
  }
  off(name, cb) {
    if (name === "connect") {
      const pos = this.connectHandlers.indexOf(cb);
      if (pos !== -1) {
        this.connectHandlers.splice(pos, 1);
      }
    } else if (name === "disconnect") {
      const pos = this.disconnectHandlers.indexOf(cb);
      if (pos !== -1) {
        this.disconnectHandlers.splice(pos, 1);
      }
    } else if (name === "reconnect") {
      const pos = this.reconnectHandlers.indexOf(cb);
      if (pos !== -1) {
        this.reconnectHandlers.splice(pos, 1);
      }
    } else if (name === "error") {
      const pos = this.errorHandlers.indexOf(cb);
      if (pos !== -1) {
        this.errorHandlers.splice(pos, 1);
      }
    } else if (this.handlers[name]) {
      const pos = this.handlers[name].indexOf(cb);
      if (pos !== -1) {
        this.handlers[name].splice(pos, 1);
        if (!this.handlers[name].length) {
          delete this.handlers[name];
        }
      }
    }
  }
  close() {
    this.pingInterval && clearInterval(this.pingInterval);
    this.pingInterval = null;
    this.authTimeout && clearTimeout(this.authTimeout);
    this.authTimeout = null;
    this.connectingTimer && clearTimeout(this.connectingTimer);
    this.connectingTimer = null;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {
      }
      this.socket = null;
    }
    if (this.connected) {
      this.disconnectHandlers.forEach((cb) => cb.call(this));
      this.connected = false;
    }
    this.callbacks = [];
    this._reconnect();
    return this;
  }
  destroy() {
    this.close();
    this.connectTimer && clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }
  _reconnect() {
    var _a;
    if (!this.connectTimer) {
      this.log.debug(`Start reconnect ${this.connectionCount}`);
      this.connectTimer = setTimeout(() => {
        var _a2;
        if (!this.options) {
          throw new Error("No options provided!");
        }
        this.connectTimer = null;
        if (this.connectionCount < (((_a2 = this.options) == null ? void 0 : _a2.connectMaxAttempt) || 5)) {
          this.connectionCount++;
        }
        this.connect(this.url, this.options);
      }, this.connectionCount * (((_a = this.options) == null ? void 0 : _a.connectInterval) || 1e3));
    } else {
      this.log.debug(`Reconnect is already running ${this.connectionCount}`);
    }
  }
}
function connect(url, options) {
  const socketClient = new SocketClient();
  socketClient.connect(url, options);
  return socketClient;
}
window.io = {
  connect
};
//# sourceMappingURL=socket.io.js.map
