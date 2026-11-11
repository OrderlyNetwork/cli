import { headers as wasmHeaders, public_key_from_private_key, public_key_base58, sign as wasmSign, verify as wasmVerify, sign_headers as wasmSignHeaders } from "../wasm/orderly_wasm.js";
export type Network = "mainnet" | "testnet";
export type Resolution = "1m" | "5m" | "15m" | "1h";
export interface Signer {
    /** Orderly account id (hex). */
    accountId: string;
    /** Standard-base64 Ed25519 public key. */
    publicKey: string;
    /** Sign a UTF-8 message and return base64url without padding. */
    sign(message: string): string | Promise<string>;
}
export interface ClientOptions {
    network?: Network;
    /** Override the API base URL. */
    baseUrl?: string;
    /** Required for authenticated requests. */
    signer?: Signer;
    /** Inject a fetch implementation (Workers, tests, custom transport). */
    fetch?: typeof fetch;
}
export interface PreparedRequest {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    body: string | null;
    requiresAuth: boolean;
}
export interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
export interface PlaceOrderParams {
    symbol: string;
    side: "BUY" | "SELL";
    orderType?: "MARKET" | "LIMIT";
    quantity: string | number;
    price?: string | number;
    reduceOnly?: boolean;
    clientOrderId?: string;
}
export interface OrderQuery {
    symbol?: string;
    status?: string;
    side?: "BUY" | "SELL";
    orderType?: string;
    sortBy?: string;
    page?: number;
    size?: number;
    productType?: "PERP" | "BINARY";
}
export declare class OrderlyApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string);
}
/**
 * The WASM core is initialized automatically on import. This export exists for
 * callers that prefer to make initialization explicit.
 */
export declare function initOrderly(): boolean;
/** Ed25519 signer backed by a base64 seed. Intended for testnet and local use. */
export declare class MemorySigner implements Signer {
    #private;
    readonly accountId: string;
    readonly publicKey: string;
    constructor(options: {
        accountId: string;
        privateKey: string;
    });
    sign(message: string): string;
}
/** Low-level request builder. Useful for dry runs and custom transports. */
export declare function prepare(kind: string, params: unknown): PreparedRequest;
/** Low-level signing helpers. */
export declare const crypto: {
    sign: typeof wasmSign;
    verify: typeof wasmVerify;
    publicKeyFromPrivateKey: typeof public_key_from_private_key;
    publicKeyBase58: typeof public_key_base58;
    headers: typeof wasmHeaders;
    signHeaders: typeof wasmSignHeaders;
};
export declare class OrderlyClient {
    #private;
    readonly network: Network;
    readonly baseUrl: string;
    readonly signer?: Signer;
    constructor(options?: ClientOptions);
    /** Send a prepared request through the configured signer and transport. */
    request(kind: string, params?: unknown): Promise<unknown>;
    market(): Promise<Record<string, unknown>[]>;
    marketPrice(symbol: string): Promise<Record<string, unknown>>;
    klines(symbol: string, resolution?: Resolution, count?: number): Promise<Candle[]>;
    positions(productType?: "PERP" | "BINARY"): Promise<Record<string, unknown>[]>;
    positionsPayload(productType?: "PERP" | "BINARY"): Promise<{
        rows?: Record<string, unknown>[];
        account_value?: number;
        total_collateral_value?: number;
        free_collateral?: number;
    }>;
    balance(): Promise<Record<string, unknown>[]>;
    account(): Promise<Record<string, unknown>>;
    orders(query?: OrderQuery): Promise<Record<string, unknown>[]>;
    trades(query?: {
        symbol?: string;
        size?: number;
        page?: number;
        productType?: "PERP" | "BINARY";
    }): Promise<Record<string, unknown>[]>;
    order(orderId: string): Promise<Record<string, unknown>>;
    placeOrder(params: PlaceOrderParams): Promise<Record<string, unknown>>;
    closePosition(symbol: string, partialQuantity?: number): Promise<Record<string, unknown>>;
    setLeverage(symbol: string, leverage: number): Promise<Record<string, unknown>>;
    getLeverage(symbol: string): Promise<Record<string, unknown>>;
    cancelAll(symbol?: string): Promise<Record<string, unknown>>;
    cancelOrder(orderId: string, symbol?: string): Promise<Record<string, unknown>>;
}
//# sourceMappingURL=index.d.ts.map