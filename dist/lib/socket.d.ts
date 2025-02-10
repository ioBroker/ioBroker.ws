import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { SocketWS } from './socketWS';
import { type Store, type WhiteListSettings, type SocketSubscribeTypes, type SocketSettings } from '@iobroker/socket-classes';
type Server = HttpServer | HttpsServer;
export declare class Socket {
    ioServer: SocketWS | null;
    constructor(server: Server, settings: SocketSettings, adapter: ioBroker.Adapter, store: Store, checkUser?: (user: string, pass: string, cb: (error: Error | null, result?: {
        logged_in: boolean;
    }) => void) => void);
    getWhiteListIpForAddress(remoteIp: string, whiteListSettings: {
        [address: string]: WhiteListSettings;
    }): string | null;
    publishAll(type: SocketSubscribeTypes, id: string, obj: ioBroker.Object | ioBroker.State | null | undefined): void;
    publishFileAll(id: string, fileName: string, size: number | null): void;
    publishInstanceMessageAll(sourceInstance: string, messageType: string, sid: string, data: any): void;
    sendLog(obj: ioBroker.LogMessage): void;
    close(): void;
}
export {};
