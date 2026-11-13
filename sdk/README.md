# @orderly.network/cli-wasm

Orderly CLI core as WebAssembly: request construction, signing and auth headers
for JavaScript and browsers. Same Rust code as the binary; you provide the signer
instead of the OS keychain.

This is not a command-line tool: there is no `orderly` command and no keychain
access. Install [`@orderly.network/cli`](https://www.npmjs.com/package/@orderly.network/cli)
for the native binary.

```ts
import { MemorySigner, OrderlyClient } from "@orderly.network/cli-wasm";

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
the private key in a platform keystore, HSM, or remote signing service. This
package only sends the exact message and consumes the signature.

## Build

The crate lives in `bindings/wasm`; the TypeScript wrapper lives in `sdk/`. The
published package is the repository root.

```bash
pnpm install
pnpm build   # cargo build + wasm-bindgen + tsc
pnpm test
```

The WASM core covers perps only for now: market data, account, positions, orders,
leverage, trades, and cancel operations. Wallet registration, Predict, and
WebSocket streams remain native CLI features.
