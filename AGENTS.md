# AGENTS.md - Orderly CLI

## Project Overview

A CLI tool for Orderly Network trading with secure OS keychain-based authentication. Keys are **never exposed** to AI context - the CLI handles signing internally and returns only results.

**Key Technologies:**

- TypeScript (ES modules)
- `cac` for CLI framework
- `keytar` for OS keychain access
- `@noble/curves` for Ed25519 cryptography
- `axios` for HTTP requests
- `ora` for spinners, `kleur` for colors
- `esbuild` for bundling
- ESLint + Prettier for code quality

## Security Architecture

### Why This Approach?

- **MCP is unsuitable for authenticated operations** - MCP tools receive/return data to AI context, exposing private keys
- **CLI with OS keychain is the solution** - Keys stored securely, CLI signs requests internally, AI sees only results

### Key Storage

Keys are stored in the OS keychain (never in files):

| OS      | Storage                 |
| ------- | ----------------------- |
| macOS   | Keychain                |
| Windows | Credential Manager      |
| Linux   | libsecret/gnome-keyring |

### Authentication Flow

1. **Layer 1 (Wallet)**: EIP-712 (EVM) or Ed25519 (Solana) - for account registration
2. **Layer 2 (API)**: Ed25519 keypair for trading operations

This CLI manages **Layer 2** - the Ed25519 API keys.

### Request Signing

All authenticated requests include these headers:

```
orderly-timestamp: <unix_ms>
orderly-account-id: <account_id>
orderly-key: <base64_public_key>
orderly-signature: <base64_signature>
```

Signature = `Ed25519Sign(METHOD + PATH + BODY + TIMESTAMP)`

## Architecture

```
src/
├── index.ts              # CLI entry point (cac setup)
├── types.ts              # TypeScript interfaces
├── commands/
│   ├── auth.ts           # Key management
│   ├── account.ts        # Account info & balance
│   ├── order.ts          # Place/cancel/list orders
│   ├── positions.ts      # List/close positions
│   └── market.ts         # Public market data
└── lib/
    ├── keychain.ts       # OS keychain (keytar)
    ├── crypto.ts         # Ed25519 key gen & signing
    ├── config.ts         # ~/.orderly-cli/config.json
    └── api.ts            # REST client with auto-signing
```

## CLI Commands

### Authentication

```bash
# Generate new Ed25519 keypair, store in OS keychain
orderly auth init

# Import existing key
orderly auth import <base64-private-key> --account <account-id>

# List stored keys (public keys only)
orderly auth list

# Show public key for account
orderly auth show [account-id]

# Remove key from keychain
orderly auth logout [account-id]
```

### Account

```bash
# Get account info (requires auth)
orderly account info [account-id]

# Get balances (requires auth)
orderly account balance [account-id]
```

### Orders

```bash
# Place order
orderly order place <symbol> <side> <type> <quantity> [--price <price>]

# Examples:
orderly order place PERP_ETH_USDC BUY LIMIT 0.01 --price 3500
orderly order place PERP_BTC_USDC SELL MARKET 0.001

# Cancel order
orderly order cancel <order-id>

# List orders
orderly order list [--symbol <symbol>]
```

### Positions

```bash
# List open positions
orderly positions list

# Close position
orderly positions close <symbol>
```

### Market Data (Public - No Auth)

```bash
# Get current price
orderly market price <symbol>

# Get orderbook
orderly market orderbook <symbol>
```

## Configuration

Config stored at `~/.orderly-cli/config.json`:

```json
{
  "apiBaseUrl": "https://api.orderly.org",
  "wsBaseUrl": "wss://ws-api.orderly.org",
  "defaultAccountId": "12345"
}
```

Non-sensitive data only. Keys are in OS keychain.

## Common Tasks

### Build

```bash
yarn build              # Production build
yarn dev                # Watch mode
```

### Development

```bash
yarn start --help       # Run CLI
node dist/index.js auth init
```

### Code Quality

```bash
yarn lint               # Check for issues
yarn lint:fix           # Fix auto-fixable issues
yarn format             # Format all files
yarn format:check       # Check formatting
yarn typecheck          # TypeScript check
```

### Testing

```bash
yarn test               # Run tests (vitest)
yarn test:run           # Run once
```

## Key Files

### `src/lib/keychain.ts`

OS keychain integration using `keytar`:

- `storeKey(accountId, keyPair)` - Store keypair in keychain
- `getKey(accountId)` - Retrieve keypair
- `deleteKey(accountId)` - Remove keypair
- `listKeys()` - List all stored keys (public keys only)
- `hasKey(accountId)` - Check if key exists

### `src/lib/crypto.ts`

Ed25519 cryptography using `@noble/curves`:

- `generateKeyPair()` - Generate new Ed25519 keypair
- `sign(message, privateKeyBase64)` - Sign a message
- `verify(message, signature, publicKey)` - Verify signature
- `publicKeyFromPrivateKey(privateKeyBase64)` - Derive public key

### `src/lib/api.ts`

REST client with automatic request signing:

```typescript
const client = new OrderlyClient();
client.setKeyPair(keyPair);  // Load from keychain

// All requests automatically signed
await client.getAccountInfo();
await client.placeOrder({ symbol, side, ... });
```

### `src/lib/config.ts`

Config file management:

- `loadConfig()` - Load config from `~/.orderly-cli/config.json`
- `saveConfig(config)` - Save config
- `setDefaultAccount(accountId)` - Set default account
- `getDefaultAccount()` - Get default account

## Dependencies

### Production

| Package         | Purpose                        |
| --------------- | ------------------------------ |
| `cac`           | CLI framework (lightweight)    |
| `keytar`        | OS keychain access             |
| `@noble/curves` | Ed25519 cryptography (pure JS) |
| `axios`         | HTTP client                    |
| `kleur`         | Terminal colors                |
| `ora`           | Spinners                       |
| `prompts`       | Interactive prompts            |
| `zod`           | Validation                     |

### Dev

| Package            | Purpose             |
| ------------------ | ------------------- |
| `typescript`       | TypeScript compiler |
| `esbuild`          | Bundler             |
| `eslint` + plugins | Linting             |
| `prettier`         | Formatting          |
| `vitest`           | Testing             |

## Orderly API Reference

### Base URL

- **Mainnet**: `https://api.orderly.org`
- **Testnet**: `https://testnet-api.orderly.org`

### Key Endpoints

| Endpoint                       | Auth | Description    |
| ------------------------------ | ---- | -------------- |
| `GET /v1/client/info`          | Yes  | Account info   |
| `GET /v1/client/holding`       | Yes  | Balances       |
| `POST /v1/order`               | Yes  | Place order    |
| `DELETE /v1/order/:id`         | Yes  | Cancel order   |
| `GET /v1/orders`               | Yes  | List orders    |
| `GET /v1/positions`            | Yes  | List positions |
| `POST /v1/positions/close`     | Yes  | Close position |
| `GET /v1/orderbook/:symbol`    | No   | Orderbook      |
| `GET /v1/public/kline/:symbol` | No   | Klines         |

### Signature Format

```
message = METHOD + PATH + BODY + TIMESTAMP
signature = Ed25519Sign(message, privateKey)
```

Example:

```
message = "POST/v1/order{"symbol":"PERP_ETH_USDC"}1699999999999"
```

## Testing

Run the test suite:

```bash
yarn test:run
```

Tests are in `src/__tests__/` using Vitest.

## Troubleshooting

### Keychain Issues (Linux)

On Linux, `keytar` requires `libsecret`:

```bash
# Debian/Ubuntu
sudo apt-get install libsecret-1-0 libsecret-1-dev

# Fedora
sudo dnf install libsecret-devel

# Arch
sudo pacman -S libsecret
```

### Keychain Issues (macOS)

If keychain prompts for password repeatedly:

```bash
# Reset keychain permissions
security delete-keychain login.keychain-db
```

### Build Errors

- Run `yarn install` to ensure all dependencies
- Check TypeScript version: `yarn typecheck`
- Clear dist: `rm -rf dist && yarn build`

### API Errors

- **401 Unauthorized**: Key not registered with Orderly account
- **403 Forbidden**: Signature invalid or expired
- **400 Bad Request**: Check order parameters

## Integration with AI Agents

AI agents can safely use this CLI without exposing private keys:

```bash
# AI calls this
orderly account info

# CLI:
# 1. Reads key from OS keychain (secure)
# 2. Signs request internally
# 3. Returns only the result

# Keys NEVER appear in AI context
```

## License

MIT
