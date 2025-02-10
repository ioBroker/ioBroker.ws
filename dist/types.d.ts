import type { SocketWS } from './lib/socketWS';
import type { Socket as IOSocketClass } from './lib/socket';

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

export type { SocketWS };
export type { IOSocketClass };
