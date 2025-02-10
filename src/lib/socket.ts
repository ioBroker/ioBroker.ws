import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';

import { SocketIO as WebSocketServer } from '@iobroker/ws-server';
import { SocketWS } from './socketWS';
import {
    type Store,
    SocketCommon,
    type WhiteListSettings,
    type SocketSubscribeTypes,
    type SocketSettings,
} from '@iobroker/socket-classes';

type Server = HttpServer | HttpsServer;

export class Socket {
    public ioServer: SocketWS | null;
    constructor(
        server: Server,
        settings: SocketSettings,
        adapter: ioBroker.Adapter,
        store: Store,
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
        ) => void,
    ) {
        this.ioServer = new SocketWS(settings, adapter);
        this.ioServer.start(server, WebSocketServer, {
            checkUser,
            store,
            secret: settings.secret,
        });
    }

    getWhiteListIpForAddress(
        remoteIp: string,
        whiteListSettings: {
            [address: string]: WhiteListSettings;
        },
    ): string | null {
        return SocketCommon.getWhiteListIpForAddress(remoteIp, whiteListSettings);
    }

    publishAll(type: SocketSubscribeTypes, id: string, obj: ioBroker.Object | ioBroker.State | null | undefined): void {
        return this.ioServer?.publishAll(type, id, obj);
    }

    publishFileAll(id: string, fileName: string, size: number | null): void {
        return this.ioServer?.publishFileAll(id, fileName, size);
    }

    publishInstanceMessageAll(sourceInstance: string, messageType: string, sid: string, data: any): void {
        return this.ioServer?.publishInstanceMessageAll(sourceInstance, messageType, sid, data);
    }

    sendLog(obj: ioBroker.LogMessage): void {
        this.ioServer?.sendLog(obj);
    }

    close(): void {
        if (this.ioServer) {
            this.ioServer.close();
            this.ioServer = null;
        }
    }
}
