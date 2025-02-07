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
    leCheckPort: number | string;
}
