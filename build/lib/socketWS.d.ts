import { SocketCommon, type Store, type SocketSubscribeTypes } from '@iobroker/socket-classes';
import type { Socket as WebSocketClient } from '@iobroker/ws-server';
export declare class SocketWS extends SocketCommon {
    #private;
    __getIsNoDisconnect(): boolean;
    __initAuthentication(authOptions: {
        store: Store;
        secret?: string;
        oauth2Only?: boolean;
        checkUser?: (user: string, pass: string, cb: (error: Error | null, result?: {
            logged_in: boolean;
            user?: string;
        }) => void) => void;
    }): void;
    __getSessionID(socket: WebSocketClient): string | null;
    publishAll(type: SocketSubscribeTypes, id: string, obj: ioBroker.Object | ioBroker.State | null | undefined): void;
    publishFileAll(id: string, fileName: string, size: number | null): void;
    publishInstanceMessageAll(sourceInstance: string, messageType: string, sid: string, data: any): void;
}
