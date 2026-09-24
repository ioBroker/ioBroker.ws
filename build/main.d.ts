import { type NextFunction, type Request, type Response } from 'express';
import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';
import { type WsConfig } from '@iobroker/ws-server-library';
/** The adapter's `native` configuration: the shape from the library plus what this adapter adds itself. */
export interface WsAdapterConfig extends WsConfig {
    /**
     * Speak HTTP/2, with HTTP/1.1 as fallback for clients that do not offer it. Has an effect only with
     * {@link WsConfig.secure}: browsers use HTTP/2 over TLS only. Enabled by default; switch it off to
     * stay with HTTP/1.1.
     */
    http2: boolean;
}
export declare class WsAdapter extends Adapter {
    config: WsAdapterConfig;
    private server;
    private readonly socketIoFile;
    private store;
    private secret;
    private certificates;
    private bruteForce;
    private fileCache;
    constructor(options?: Partial<AdapterOptions>);
    onUnload(callback: () => void): void;
    onMessage(obj: ioBroker.Message): void;
    private readCached;
    private getContentType;
    checkUser: (username: string, password: string, cb: (error: null | Error, result?: {
        logged_in: boolean;
        user?: string;
    }) => void) => void;
    detectUser: (req: Request, res: Response, next: NextFunction) => void;
    serveStaticFile: (req: Request, res: Response, next: NextFunction) => void;
    initWebServer(): void;
    main(): Promise<void>;
}
