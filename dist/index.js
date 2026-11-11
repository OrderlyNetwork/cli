import { initSync, prepare as wasmPrepare, message as wasmMessage, headers as wasmHeaders, public_key_from_private_key, public_key_base58, sign as wasmSign, verify as wasmVerify, sign_headers as wasmSignHeaders, } from "../wasm/orderly_wasm.js";
import { wasmBase64 } from "../wasm/orderly_wasm_base64.js";
export class OrderlyApiError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`Orderly API ${status}: ${body.slice(0, 300)}`);
        this.name = "OrderlyApiError";
        this.status = status;
        this.body = body;
    }
}
const BASE_URLS = {
    mainnet: "https://api.orderly.org",
    testnet: "https://testnet-api.orderly.org",
};
const RESOLUTION_SECONDS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
};
const TV_RESOLUTION = {
    "1m": "1",
    "5m": "5",
    "15m": "15",
    "1h": "60",
};
let initialized = false;
/**
 * The WASM core is initialized automatically on import. This export exists for
 * callers that prefer to make initialization explicit.
 */
export function initOrderly() {
    if (!initialized) {
        initialized = true;
        initSync({
            module: Uint8Array.from(atob(wasmBase64), (character) => character.charCodeAt(0)),
        });
    }
    return true;
}
initOrderly();
/** Ed25519 signer backed by a base64 seed. Intended for testnet and local use. */
export class MemorySigner {
    accountId;
    publicKey;
    #privateKey;
    constructor(options) {
        this.accountId = options.accountId;
        this.#privateKey = options.privateKey;
        this.publicKey = public_key_from_private_key(options.privateKey);
    }
    sign(message) {
        return wasmSign(message, this.#privateKey);
    }
}
/** Low-level request builder. Useful for dry runs and custom transports. */
export function prepare(kind, params) {
    return wasmPrepare(kind, params);
}
/** Low-level signing helpers. */
export const crypto = {
    sign: wasmSign,
    verify: wasmVerify,
    publicKeyFromPrivateKey: public_key_from_private_key,
    publicKeyBase58: public_key_base58,
    headers: wasmHeaders,
    signHeaders: wasmSignHeaders,
};
export class OrderlyClient {
    network;
    baseUrl;
    signer;
    #fetch;
    constructor(options = {}) {
        this.network = options.network ?? "testnet";
        this.baseUrl = (options.baseUrl ?? BASE_URLS[this.network]).replace(/\/$/, "");
        this.signer = options.signer;
        const fetchImpl = options.fetch ?? globalThis.fetch;
        if (!fetchImpl)
            throw new Error("No fetch implementation available");
        this.#fetch = fetchImpl.bind(globalThis);
    }
    /** Send a prepared request through the configured signer and transport. */
    async request(kind, params = {}) {
        const prepared = wasmPrepare(kind, params);
        const headers = {
            "content-type": prepared.method === "GET" || prepared.method === "DELETE"
                ? "application/x-www-form-urlencoded"
                : "application/json",
        };
        if (prepared.requiresAuth) {
            if (!this.signer)
                throw new Error("This request requires a signer");
            const timestamp = Date.now();
            const message = wasmMessage(timestamp, prepared.method, prepared.path, prepared.body ?? undefined);
            const signature = await this.signer.sign(message);
            Object.assign(headers, wasmHeaders(this.signer.accountId, this.signer.publicKey, signature, timestamp));
        }
        const response = await this.#fetch(`${this.baseUrl}${prepared.path}`, {
            method: prepared.method,
            headers,
            body: prepared.method === "GET" || prepared.method === "DELETE"
                ? undefined
                : (prepared.body ?? undefined),
        });
        const text = await response.text();
        if (!response.ok)
            throw new OrderlyApiError(response.status, text);
        if (!text)
            return null;
        try {
            return unwrapResponse(JSON.parse(text));
        }
        catch {
            return text;
        }
    }
    async market() {
        const data = (await this.request("market"));
        return Array.isArray(data?.rows) ? data.rows : [];
    }
    async marketPrice(symbol) {
        return (await this.request("market_price", { symbol }));
    }
    async klines(symbol, resolution = "5m", count = 200) {
        const to = Math.floor(Date.now() / 1000);
        const from = to - count * RESOLUTION_SECONDS[resolution];
        const data = (await this.request("klines", {
            symbol,
            resolution: TV_RESOLUTION[resolution],
            from,
            to,
        }));
        if (data?.s !== "ok" || !data.t)
            return [];
        return data.t.map((time, index) => ({
            time,
            open: Number(data.o?.[index]),
            high: Number(data.h?.[index]),
            low: Number(data.l?.[index]),
            close: Number(data.c?.[index]),
            volume: Number(data.v?.[index]),
        }));
    }
    async positions(productType) {
        const data = await this.positionsPayload(productType);
        return Array.isArray(data?.rows) ? data.rows : [];
    }
    async positionsPayload(productType) {
        return (await this.request("positions", { productType }));
    }
    async balance() {
        const data = (await this.request("balance"));
        return Array.isArray(data?.holding) ? data.holding : [];
    }
    async account() {
        return (await this.request("account"));
    }
    async orders(query = {}) {
        const data = (await this.request("orders", query));
        return Array.isArray(data?.rows) ? data.rows : [];
    }
    async trades(query = {}) {
        const data = (await this.request("trades", query));
        return Array.isArray(data?.rows) ? data.rows : [];
    }
    async order(orderId) {
        return (await this.request("order", { orderId }));
    }
    async placeOrder(params) {
        return (await this.request("place_order", {
            ...params,
            quantity: String(params.quantity),
            price: params.price == null ? undefined : String(params.price),
        }));
    }
    async closePosition(symbol, partialQuantity) {
        const positions = await this.positions();
        const position = positions.find((row) => row.symbol === symbol);
        const quantity = Number(position?.position_qty ?? 0);
        if (!quantity)
            throw new Error(`No open position found for ${symbol}`);
        return (await this.request("close_position", {
            symbol,
            positionQty: quantity,
            partialQuantity,
        }));
    }
    async setLeverage(symbol, leverage) {
        return (await this.request("set_leverage", { symbol, leverage }));
    }
    async getLeverage(symbol) {
        return (await this.request("get_leverage", { symbol }));
    }
    async cancelAll(symbol) {
        return (await this.request("cancel_all", { symbol }));
    }
    async cancelOrder(orderId, symbol) {
        return (await this.request("cancel_order", { orderId, symbol }));
    }
}
function unwrapResponse(payload) {
    if (!payload || typeof payload !== "object")
        return payload;
    const record = payload;
    if ("data" in record) {
        if (record.success === false) {
            throw new OrderlyApiError(400, JSON.stringify(payload));
        }
        return record.data ?? null;
    }
    return payload;
}
//# sourceMappingURL=index.js.map