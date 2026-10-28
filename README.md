# orderly

CLI for Orderly Network trading, with secure OS keychain authentication. Ships
as a single static binary — no Node.js runtime required.

## Features

- **Secure key storage** — wallet and API keys live in the OS keychain, never in files
- **AI-friendly** — keys are never exposed in output; the CLI returns only results
- **Full trading support** — place/cancel orders, algo orders, positions, leverage
- **Multi-chain** — EVM (Arbitrum, Base, Optimism, …) and Solana

## Install

One line — detects Linux/macOS and x86_64/arm64, verifies the release checksum,
and installs to `~/.local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/OrderlyNetwork/cli/master/install.sh | sh
```

Override the target with `ORDERLY_INSTALL_DIR=/usr/local/bin`, or pin a release
with `ORDERLY_VERSION=v2.0.1`. Windows has no shell installer yet:

```powershell
# Windows x86_64 (use aarch64-pc-windows-msvc on ARM)
Invoke-WebRequest https://github.com/OrderlyNetwork/cli/releases/latest/download/orderly-x86_64-pc-windows-msvc.zip -OutFile orderly.zip
Expand-Archive orderly.zip -DestinationPath "$env:LOCALAPPDATA\orderly"
```

Manual archives, per-platform assets, verification and building from source are
in [`INSTALL.md`](INSTALL.md).

Every release asset is covered by SHA-256 checksums, a GitHub build-provenance
attestation and a cosign signature — see [`INSTALL.md`](INSTALL.md#verify-the-download).

## Quick Start (Testnet)

```bash
# 1. Create a new EVM wallet
orderly wallet-create --type EVM --network testnet

# 2. Register Orderly account
orderly wallet-register --broker-id demo --network testnet

# 3. Request test USDC (wait a few minutes for delivery)
orderly faucet-usdc <address> --broker-id demo --chain-id 421614 --network testnet

# 4. Add API key for trading (generates Ed25519 key automatically)
orderly wallet-add-key --broker-id demo --scope read,trading --network testnet

# 5. List accounts to get your account ID
orderly auth-list --network testnet

# 6. Check balance
orderly account-balance --account <account-id> --network testnet

# 7. Place an order
orderly order-place PERP_ETH_USDC BUY MARKET 0.01 --account <account-id> --network testnet
```

**Note:** `--account` is required for all authenticated commands. Use
`auth-list` to see available accounts.

## Common Commands

```bash
# Account management
orderly account-info --account <account-id>
orderly account-balance --account <account-id>

# Trading - Orders
orderly order-place PERP_ETH_USDC BUY LIMIT 0.01 --price 3500 --account <account-id>
orderly order-place PERP_ETH_USDC BUY MARKET 0.01 --client-order-id my-order-123 --account <account-id>
orderly order-cancel <order-id> --symbol PERP_ETH_USDC --account <account-id>
orderly order-list --status NEW --account <account-id>

# Trading - Algo Orders (TP/SL)
orderly algo-order-place PERP_ETH_USDC BUY STOP 0.01 --trigger-price 2000 --account <account-id>
orderly algo-order-place PERP_ETH_USDC SELL TP_SL 0.01 --tp-trigger-price 2500 --sl-trigger-price 1500 --account <account-id>
orderly algo-order-list --account <account-id>

# Positions
orderly positions-list --account <account-id>
orderly positions-close PERP_ETH_USDC --account <account-id>

# Market data
orderly market-price PERP_ETH_USDC
orderly market-trades PERP_ETH_USDC --limit 20
orderly funding-rates
orderly kline PERP_ETH_USDC 1h --limit 100 --account <account-id>
orderly symbols
```

Run `orderly --help` for the complete command reference.

## Output Format

By default, output is compact JSON (no whitespace) for AI/programmatic use:

```bash
orderly market-price PERP_ETH_USDC
# {"symbol":"PERP_ETH_USDC","index_price":2124.82,"mark_price":2124.89,...}
```

Use `--csv` for tabular data (more token-efficient for lists):

```bash
orderly symbols --csv
# symbol,index_price,mark_price,...
# PERP_ETH_USDC,2124.82,2124.89,...
# PERP_BTC_USDC,71551.7,71551.7,...
```

## Security

- Private keys are stored in the OS keychain:
  - **macOS**: Keychain
  - **Windows**: Credential Manager
  - **Linux**: Secret Service (libsecret / gnome-keyring)
- Keys are **never** written to disk in plain text, printed in output, or
  accessible to agents.
- Request signing (Ed25519, EIP-712, Solana) is byte-identical to the original
  TypeScript implementation.

### Keychain compatibility

On Linux the crate talks to the Secret Service directly using the
`org.freedesktop.Secret.Generic` schema with `service`/`account` attributes —
the same items `keytar` used — so credentials created by the legacy
TypeScript/npm CLI remain readable, and vice versa. On macOS/Windows the OS
store is used via `keyring`.

On Linux, credentials are enumerated directly from the Secret Service, so
`auth-list`, `wallet-list` and account auto-resolution return the same set. On
macOS/Windows the `keyring` crate cannot enumerate, so an index at
`~/.orderly-cli/keys-index.json` is used as a fallback; secrets themselves only
ever live in the keychain.

## Compatibility

This is a behavioral replacement for the legacy TypeScript CLI
(`@orderly.network/cli` ≤ 1.2.0): same commands, flags, output, config path
(`~/.orderly-cli/config.json`), keychain entries and wire signatures.

Known divergences — all restricted to **invalid input**; valid usage is
byte-identical:

| Case | TypeScript | Rust |
| --- | --- | --- |
| Non-numeric value for a numeric arg/flag (e.g. `leverage SYM abc`, `--size abc`) | `parseFloat`/`parseInt` → `NaN`, propagated (often silently omitted or sent as `null`) | rejected at parse time with a clear error |
| Unexpected extra positional (`orderly settle-pnl-history x`) | ignored by cac | rejected |
| `--network bogus` | crashes with a JS `TypeError` | clean error message |
| `--version` | `orderly/<v> <platform> node-<ver>` | `orderly <v>` |
| Network/DNS failure | Node's `getaddrinfo ...` text | reqwest's error text |

The top-level `--help` text, the `Commands:` list and the "missing required
args" diagnostic are byte-for-byte reproductions of the TypeScript CLI.

## Development

```bash
cargo build --release          # -> target/release/orderly (~5 MB)
cargo test                     # unit + offline parity fixtures
cargo clippy --all-targets     # must be warning-free
cargo fmt --check
```

Live tests (`tests/api_live.rs`, `tests/ws_live.rs`,
`tests/keychain_interop.rs`) skip automatically when offline.

`Cargo.toml` uses a size-optimized profile (`opt-level = "z"`, LTO,
`panic = "abort"`, `strip`).

### Parity fixtures

`parity/fixtures/` holds output recorded from the real TypeScript implementation
before it was removed (JSON/CSV rendering, Ed25519, EIP-712, Solana signing, and
the full `--help` text). The tests diff the Rust implementation against those
recorded bytes offline, so behavior is pinned without a Node.js toolchain.

## License

MIT
