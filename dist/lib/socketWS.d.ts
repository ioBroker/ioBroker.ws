import { SocketCommon, type Store } from '@iobroker/socket-classes';
import type { Socket as WebSocketClient } from '@iobroker/ws-server';
import type { AddressInfo } from 'node:net';
import type { SocketSubscribeTypes } from '@iobroker/socket-classes/dist/types';
export declare class SocketWS extends SocketCommon {
    #private;
    __getIsNoDisconnect(): boolean;
    __initAuthentication(authOptions: {
        store: Store;
        secret: string;
        checkUser?: (user: string, pass: string, cb: (error: Error | null, result?: {
            logged_in: boolean;
        }) => void) => void;
    }): void;
    __getUserFromSocket(socket: WebSocketClient, callback: (error: string | null, user?: string) => void): void;
    __getClientAddress(socket: WebSocketClient): AddressInfo;
    __updateSession(socket: WebSocketClient): boolean;
    __getSessionID(socket: WebSocketClient): string | null;
    publishAll(type: SocketSubscribeTypes, id: string, obj: ioBroker.Object | ioBroker.State | null | undefined): void;
    publishFileAll(id: string, fileName: string, size: number | null): void;
    publishInstanceMessageAll(sourceInstance: string, messageType: string, sid: string, data: any): void;
}
