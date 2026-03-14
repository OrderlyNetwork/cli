# @orderly.network/cli

CLI tool for Orderly Network trading with secure OS keychain authentication.

## Features

- **Secure key storage** - Wallet and API keys stored in OS keychain (never in files)
- **AI-friendly** - Keys never exposed to AI context, CLI returns only results
- **Full trading support** - Place/cancel orders, manage positions, set leverage
- **Multi-chain** - Supports EVM (Arbitrum, Base, Optimism, etc.) and Solana

## Installation

```bash
cd cli
yarn install
yarn build
```

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

**Note:** The `--account` flag is required for all authenticated commands. Use `auth-list` to see available accounts.

## Common Commands

```bash
# Account management
orderly account-info --account <account-id>
orderly account-balance --account <account-id>

# Trading
orderly order-place PERP_ETH_USDC BUY LIMIT 0.01 --price 3500 --account <account-id>
orderly order-cancel <order-id> --symbol PERP_ETH_USDC --account <account-id>
orderly order-list --account <account-id>
orderly positions-list --account <account-id>
orderly positions-close PERP_ETH_USDC --account <account-id>

# Market data (no auth required)
orderly market-price PERP_ETH_USDC
orderly symbols
```

## Security

- Private keys are stored in the OS keychain:
  - **macOS**: Keychain
  - **Windows**: Credential Manager
  - **Linux**: libsecret/gnome-keyring

- Keys are **never**:
  - Written to disk in plain text
  - Exposed in CLI output
  - Accessible to AI agents

## Commands

Run `orderly --help` for the complete command reference.

## Development

```bash
yarn dev          # Watch mode build
yarn build        # Production build
yarn lint         # Check for issues
yarn format       # Format code
yarn typecheck    # TypeScript check
yarn test         # Run tests
```

## License

MIT
