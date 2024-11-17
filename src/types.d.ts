declare global {
    namespace ioBroker {
        interface AdapterConfig {
            port: number;
            auth: boolean;
            secure: boolean;
            bind: string;
            ttl: number;
            certPublic: string;
            certPrivate: string;
            certChained: string;
            defaultUser: string;
            leEnabled: boolean;
            leUpdate: boolean;
            leCheckPort: number;
        }
    }
}
