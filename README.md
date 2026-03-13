# @orderly.network/cli

CLI tool for Orderly Network trading with secure OS keychain authentication.

## Features

- **Secure key storage** - Ed25519 keypairs stored in OS keychain (never in files)
- **AI-friendly** - Keys never exposed to AI context, CLI returns only results
- **Full trading support** - Place/cancel orders, manage positions
- **Public data access** - Market prices, orderbooks (no auth required)

## Installation

```bash
cd cli
yarn install
yarn build
```

## Quick Start

```bash
# Initialize authentication (generates Ed25519 keypair)
orderly auth init

# Import existing key
orderly auth import <base64-private-key> --account <account-id>

# View stored keys
orderly auth list

# Get account info
orderly account info

# Get balances
orderly account balance

# Place an order
orderly order place PERP_ETH_USDC BUY LIMIT 0.01 --price 3500

# Cancel an order
orderly order cancel <order-id>

# List orders
orderly order list --symbol PERP_ETH_USDC

# List positions
orderly positions list

# Close a position
orderly positions close PERP_ETH_USDC

# Get market price (public)
orderly market price PERP_ETH_USDC

# Get orderbook (public)
orderly market orderbook PERP_ETH_USDC
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
