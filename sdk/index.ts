import {
  initSync,
  prepare as wasmPrepare,
  message as wasmMessage,
  headers as wasmHeaders,
  public_key_from_private_key,
  public_key_base58,
  sign as wasmSign,
  verify as wasmVerify,
  sign_headers as wasmSignHeaders,
} from "../wasm/orderly_wasm.js";
import { wasmBase64 } from "../wasm/orderly_wasm_base64.js";

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

export class OrderlyApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Orderly API ${status}: ${body.slice(0, 300)}`);
    this.name = "OrderlyApiError";
    this.status = status;
    this.body = body;
  }
}

const BASE_URLS: Record<Network, string> = {
  mainnet: "https://api.orderly.org",
  testnet: "https://testnet-api.orderly.org",
};

const RESOLUTION_SECONDS: Record<Resolution, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
};

const TV_RESOLUTION: Record<Resolution, string> = {
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
export function initOrderly(): boolean {
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
export class MemorySigner implements Signer {
  readonly accountId: string;
  readonly publicKey: string;
  #privateKey: string;

  constructor(options: { accountId: string; privateKey: string }) {
    this.accountId = options.accountId;
    this.#privateKey = options.privateKey;
    this.publicKey = public_key_from_private_key(options.privateKey);
  }

  sign(message: string): string {
    return wasmSign(message, this.#privateKey);
  }
}

/** Low-level request builder. Useful for dry runs and custom transports. */
export function prepare(kind: string, params: unknown): PreparedRequest {
  return wasmPrepare(kind, params) as PreparedRequest;
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
  readonly network: Network;
  readonly baseUrl: string;
  readonly signer?: Signer;
  #fetch: typeof fetch;

  constructor(options: ClientOptions = {}) {
    this.network = options.network ?? "testnet";
    this.baseUrl = (options.baseUrl ?? BASE_URLS[this.network]).replace(/\/$/, "");
    this.signer = options.signer;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new Error("No fetch implementation available");
    this.#fetch = fetchImpl.bind(globalThis);
  }

  /** Send a prepared request through the configured signer and transport. */
  async request(kind: string, params: unknown = {}): Promise<unknown> {
    const prepared = wasmPrepare(kind, params) as PreparedRequest;
    const headers: Record<string, string> = {
      "content-type":
        prepared.method === "GET" || prepared.method === "DELETE"
          ? "application/x-www-form-urlencoded"
          : "application/json",
    };

    if (prepared.requiresAuth) {
      if (!this.signer) throw new Error("This request requires a signer");
      const timestamp = Date.now();
      const message = wasmMessage(
        timestamp,
        prepared.method,
        prepared.path,
        prepared.body ?? undefined,
      );
      const signature = await this.signer.sign(message);
      Object.assign(
        headers,
        wasmHeaders(
          this.signer.accountId,
          this.signer.publicKey,
          signature,
          timestamp,
        ),
      );
    }

    const response = await this.#fetch(`${this.baseUrl}${prepared.path}`, {
      method: prepared.method,
      headers,
      body:
        prepared.method === "GET" || prepared.method === "DELETE"
          ? undefined
          : (prepared.body ?? undefined),
    });

    const text = await response.text();
    if (!response.ok) throw new OrderlyApiError(response.status, text);
    if (!text) return null;
    try {
      return unwrapResponse(JSON.parse(text));
    } catch {
      return text;
    }
  }

  async market(): Promise<Record<string, unknown>[]> {
    const data = (await this.request("market")) as { rows?: Record<string, unknown>[] };
    return Array.isArray(data?.rows) ? data.rows : [];
  }

  async marketPrice(symbol: string): Promise<Record<string, unknown>> {
    return (await this.request("market_price", { symbol })) as Record<string, unknown>;
  }

  async klines(
    symbol: string,
    resolution: Resolution = "5m",
    count = 200,
  ): Promise<Candle[]> {
    const to = Math.floor(Date.now() / 1000);
    const from = to - count * RESOLUTION_SECONDS[resolution];
    const data = (await this.request("klines", {
      symbol,
      resolution: TV_RESOLUTION[resolution],
      from,
      to,
    })) as {
      s?: string;
      t?: number[];
      o?: Array<number | string>;
      h?: Array<number | string>;
      l?: Array<number | string>;
      c?: Array<number | string>;
      v?: Array<number | string>;
    };
    if (data?.s !== "ok" || !data.t) return [];
    return data.t.map((time, index) => ({
      time,
      open: Number(data.o?.[index]),
      high: Number(data.h?.[index]),
      low: Number(data.l?.[index]),
      close: Number(data.c?.[index]),
      volume: Number(data.v?.[index]),
    }));
  }

  async positions(productType?: "PERP" | "BINARY"): Promise<Record<string, unknown>[]> {
    const data = await this.positionsPayload(productType);
    return Array.isArray(data?.rows) ? data.rows : [];
  }

  async positionsPayload(productType?: "PERP" | "BINARY"): Promise<{
    rows?: Record<string, unknown>[];
    account_value?: number;
    total_collateral_value?: number;
    free_collateral?: number;
  }> {
    return (await this.request("positions", { productType })) as {
      rows?: Record<string, unknown>[];
      account_value?: number;
      total_collateral_value?: number;
      free_collateral?: number;
    };
  }

  async balance(): Promise<Record<string, unknown>[]> {
    const data = (await this.request("balance")) as {
      holding?: Record<string, unknown>[];
    };
    return Array.isArray(data?.holding) ? data.holding : [];
  }

  async account(): Promise<Record<string, unknown>> {
    return (await this.request("account")) as Record<string, unknown>;
  }

  async orders(query: OrderQuery = {}): Promise<Record<string, unknown>[]> {
    const data = (await this.request("orders", query)) as {
      rows?: Record<string, unknown>[];
    };
    return Array.isArray(data?.rows) ? data.rows : [];
  }

  async trades(query: {
    symbol?: string;
    size?: number;
    page?: number;
    productType?: "PERP" | "BINARY";
  } = {}): Promise<Record<string, unknown>[]> {
    const data = (await this.request("trades", query)) as {
      rows?: Record<string, unknown>[];
    };
    return Array.isArray(data?.rows) ? data.rows : [];
  }

  async order(orderId: string): Promise<Record<string, unknown>> {
    return (await this.request("order", { orderId })) as Record<string, unknown>;
  }

  async placeOrder(params: PlaceOrderParams): Promise<Record<string, unknown>> {
    return (await this.request("place_order", {
      ...params,
      quantity: String(params.quantity),
      price: params.price == null ? undefined : String(params.price),
    })) as Record<string, unknown>;
  }

  async closePosition(
    symbol: string,
    partialQuantity?: number,
  ): Promise<Record<string, unknown>> {
    const positions = await this.positions();
    const position = positions.find((row) => row.symbol === symbol);
    const quantity = Number(position?.position_qty ?? 0);
    if (!quantity) throw new Error(`No open position found for ${symbol}`);
    return (await this.request("close_position", {
      symbol,
      positionQty: quantity,
      partialQuantity,
    })) as Record<string, unknown>;
  }

  async setLeverage(symbol: string, leverage: number): Promise<Record<string, unknown>> {
    return (await this.request("set_leverage", { symbol, leverage })) as Record<
      string,
      unknown
    >;
  }

  async getLeverage(symbol: string): Promise<Record<string, unknown>> {
    return (await this.request("get_leverage", { symbol })) as Record<string, unknown>;
  }

  async cancelAll(symbol?: string): Promise<Record<string, unknown>> {
    return (await this.request("cancel_all", { symbol })) as Record<string, unknown>;
  }

  async cancelOrder(
    orderId: string,
    symbol?: string,
  ): Promise<Record<string, unknown>> {
    return (await this.request("cancel_order", { orderId, symbol })) as Record<
      string,
      unknown
    >;
  }
}

function unwrapResponse(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  if ("data" in record) {
    if (record.success === false) {
      throw new OrderlyApiError(400, JSON.stringify(payload));
    }
    return record.data ?? null;
  }
  return payload;
}
