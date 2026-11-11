# @orderly.network/orderly

WebAssembly SDK for Orderly Network, generated from the CLI's Rust core.

```ts
import { MemorySigner, OrderlyClient } from "@orderly.network/orderly";

const client = new OrderlyClient({
  network: "testnet",
  signer: new MemorySigner({ accountId, privateKey }),
});

const candles = await client.klines("PERP_BTC_USDC", "5m", 200);
const position = await client.positions("PERP");
```

The package auto-initializes its embedded WASM module. It runs in Node 18+,
Bun, browsers, and Cloudflare Workers.

## Signer interface

```ts
interface Signer {
  accountId: string;
  publicKey: string; // standard base64
  sign(message: string): string | Promise<string>; // base64url
}
```

`MemorySigner` is included for testnet and local use. A custom signer can keep
the private key in a platform keystore, HSM, or remote signing service. The SDK
only sends the exact message and consumes the signature.

## Build

The crate lives in `bindings/wasm`; this package lives in `bindings/js`.

```bash
cd bindings/js
pnpm install
pnpm build   # cargo build + wasm-bindgen + tsc
pnpm test
```

The WASM core covers perps only for now: market data, account, positions, orders,
leverage, trades, and cancel operations. Wallet registration, Predict, and
WebSocket streams remain native CLI features.
