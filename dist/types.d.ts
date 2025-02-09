import type { SocketWS } from './lib/socketWS';

export interface WsAdapterConfig {
    port: number | string;
    auth: boolean;
    secure: boolean;
    bind: string;
    ttl: number | string;
    certPublic: string;
    certPrivate: string;
    certChained: string;
    defaultUser: string;
    leEnabled: boolean;
    leUpdate: boolean;
    language: ioBroker.Languages;
    leCheckPort: number | string;
}

export declare class IOSocketClass {
    public ioServer: SocketWS | null;

    constructor(server: Server, settings: SocketSettings, adapter: ioBroker.Adapter, store: Store);

    getWhiteListIpForAddress(
        remoteIp: string,
        whiteListSettings: {
            [address: string]: WhiteListSettings;
        },
    ): string | null;
    publishAll(type: SocketSubscribeTypes, id: string, obj: ioBroker.Object | ioBroker.State | null | undefined): void;
    publishFileAll(id: string, fileName: string, size: number | null): void;
    publishInstanceMessageAll(sourceInstance: string, messageType: string, sid: string, data: any): void;
    sendLog(obj: ioBroker.LogMessage): void;
    close(): void;
}
