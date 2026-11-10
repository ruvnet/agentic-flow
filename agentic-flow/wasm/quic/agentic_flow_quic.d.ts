/* tslint:disable */
/* eslint-disable */

/**
 * WASM wrapper for QuicClient
 */
export class WasmQuicClient {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Close all connections
     */
    close(): Promise<void>;
    /**
     * Create new WASM QUIC client
     */
    constructor(config: any);
    /**
     * Get pool statistics
     */
    poolStats(): Promise<any>;
    /**
     * Receive message from server
     */
    recvMessage(addr: string): Promise<any>;
    /**
     * Send message to server
     */
    sendMessage(addr: string, message: any): Promise<void>;
}

/**
 * Create QUIC message from JavaScript
 */
export function createQuicMessage(id: string, msg_type: string, payload: Uint8Array | number[], metadata: any): any;

/**
 * Create default connection config
 */
export function defaultConfig(): any;
