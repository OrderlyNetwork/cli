#!/usr/bin/env node
import { cac } from 'cac';
import kleur from 'kleur';
import { importKey, list, logout, show, exportKey } from './commands/auth.js';
import { info, balance } from './commands/account.js';
import {
  place,
  cancel,
  edit,
  cancelAll,
  listOrders,
  batchPlace,
  batchCancel,
} from './commands/order.js';
import { listPositions, closePosition, positionHistory } from './commands/positions.js';
import { getPrice, getOrderbook, getSymbols } from './commands/market.js';
import { faucetUsdc } from './commands/faucet.js';
import {
  walletImport,
  walletList,
  walletShow,
  walletLogout,
  walletRegister,
  walletAddKey,
  walletCreate,
} from './commands/wallet.js';
import {
  getChains,
  getTokens,
  depositInfo,
  withdraw,
  withdrawSubmit,
  assetHistory,
} from './commands/assets.js';
import { getOrSetLeverage } from './commands/leverage.js';
import { listTrades } from './commands/trades.js';
import {
  placeAlgoOrder,
  cancelAlgoOrder,
  cancelAllAlgoOrders,
  listAlgoOrders,
} from './commands/algo.js';
import { fundingHistory } from './commands/funding.js';
import { getDefaultNetwork } from './lib/config.js';
import { Network, WalletType } from './types.js';

function findRawAddress(optionName: string): string | undefined {
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === `--${optionName}` && process.argv[i + 1].startsWith('0x')) {
      return process.argv[i + 1];
    }
    const eqMatch = process.argv[i].match(new RegExp(`^--${optionName}=(0x[a-fA-F0-9]+)$`));
    if (eqMatch) {
      return eqMatch[1];
    }
  }
  return undefined;
}

function normalizeAddress(address: unknown, optionName = 'address'): string | undefined {
  if (address === undefined || address === null) {
    const raw = findRawAddress(optionName);
    if (raw) return raw;
    return undefined;
  }
  const str = String(address);
  if (typeof address === 'number' || str.includes('e+') || str.includes('e-')) {
    const raw = findRawAddress(optionName);
    if (raw) return raw;
    console.error(kleur.red('Error: Hex addresses must be quoted to prevent parsing as numbers.'));
    console.error(kleur.dim('Example: --address "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"'));
    process.exit(1);
  }
  return str;
}

function requireAddress(address: unknown): string {
  const str = String(address);
  if (typeof address === 'number' || str.includes('e+') || str.includes('e-')) {
    const raw = findRawAddress('address');
    if (raw) return raw;
    console.error(kleur.red('Error: Hex addresses must be quoted to prevent parsing as numbers.'));
    console.error(kleur.dim('Example: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"'));
    process.exit(1);
  }
  return str;
}

function findRawAccountId(optionName: string): string | undefined {
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === `--${optionName}` && process.argv[i + 1].startsWith('0x')) {
      return process.argv[i + 1];
    }
    const eqMatch = process.argv[i].match(new RegExp(`^--${optionName}=(0x[a-fA-F0-9]+)$`));
    if (eqMatch) {
      return eqMatch[1];
    }
  }
  return undefined;
}

function normalizeAccountId(accountId: unknown): string | undefined {
  if (accountId === undefined || accountId === null) {
    return findRawAccountId('account');
  }
  const str = String(accountId);
  if (typeof accountId === 'number' || str.includes('e+') || str.includes('e-')) {
    const raw = findRawAccountId('account');
    if (raw) return raw;
    console.error(
      kleur.red('Error: Hex account IDs must be quoted to prevent parsing as numbers.')
    );
    console.error(
      kleur.dim(
        'Example: --account "0x1e6b18f967e262ea4ee8a1efab67c578bcc45cdcfd435c15b6913dcf14d0217e"'
      )
    );
    process.exit(1);
  }
  return str;
}

function normalizeScope(scope: unknown): string | undefined {
  if (scope === undefined || scope === null) {
    for (let i = 0; i < process.argv.length - 1; i++) {
      if (process.argv[i] === '--scope') {
        return process.argv[i + 1];
      }
      const eqMatch = process.argv[i].match(/^--scope=(.+)$/);
      if (eqMatch) {
        return eqMatch[1];
      }
    }
    return undefined;
  }
  return String(scope);
}

const QUICK_START = `
${kleur.cyan().bold('QUICK START (Testnet)')}
${kleur.dim('─'.repeat(50))}

1. Create a new wallet:
   ${kleur.green('orderly wallet-create --type EVM')}

2. Register an Orderly account:
   ${kleur.green('orderly wallet-register --broker-id demo')}

3. Get test USDC (wait a few minutes for delivery):
   ${kleur.green('orderly faucet-usdc <address> --broker-id demo --chain-id 421614')}

4. Add API key for trading:
   ${kleur.green('orderly wallet-add-key --broker-id demo')}

5. Check balance:
   ${kleur.green('orderly account-balance')}

6. Place an order:
   ${kleur.green('orderly order-place PERP_ETH_USDC BUY MARKET 0.01')}
`;

const DESCRIPTION = `
${kleur.bold('Orderly Network CLI')}
${kleur.dim('Secure keychain-based trading CLI for Orderly Network')}

This CLI uses your OS keychain (Keychain/Credential Manager/libsecret) to store
private keys securely. Keys are NEVER exposed to AI context or logged.

${kleur.cyan().bold('SETUP FLOW')}
${kleur.dim('─'.repeat(50))}

${kleur.yellow('For new users:')}
  wallet-create    → Generate a new wallet (EVM or Solana)
  wallet-register  → Register wallet with Orderly (get account ID)
  wallet-add-key   → Generate & register Ed25519 API key for trading

${kleur.yellow('For existing Orderly users with API keys:')}
  auth-import      → Import existing Ed25519 API key directly

${kleur.cyan().bold('COMMANDS BY CATEGORY')}
${kleur.dim('─'.repeat(50))}

${kleur.yellow('Setup & Auth:')}
  wallet-create, wallet-import, wallet-list, wallet-show, wallet-logout
  wallet-register, wallet-add-key
  auth-import, auth-list, auth-show, auth-logout, auth-export-key

${kleur.yellow('Trading:')}
  order-place, order-cancel, order-edit, order-cancel-all, order-list
  positions-list, positions-close

${kleur.yellow('Account:')}
  account-info, account-balance

${kleur.yellow('Market Data (no auth required):')}
  market-price, market-orderbook, symbols

${kleur.yellow('Assets:')}
  chains, tokens, deposit-info, withdraw, withdraw-submit, asset-history

${kleur.yellow('Testnet Only:')}
  faucet-usdc
`;

const cli = cac('orderly');

cli
  .version('0.1.0')
  .help(() => {
    console.log(DESCRIPTION);
    console.log(QUICK_START);
    console.log(kleur.dim('Run any command with --help for more details'));
    console.log(kleur.cyan('  orderly wallet-create --help'));
    console.log(kleur.cyan('  orderly order-place --help'));
  })
  .option('--network <network>', 'Network: mainnet or testnet (default: testnet)', {
    default: getDefaultNetwork(),
  });

// Wallet commands - Setup flow
cli
  .command('wallet-create', 'Create a new EVM or Solana wallet')
  .option('--type <type>', 'Wallet type: EVM or SOL (default: prompts)')
  .example('orderly wallet-create --type EVM')
  .example('orderly wallet-create --type SOL')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void walletCreate(options.type as WalletType, network);
  });

cli
  .command('wallet-import', 'Import an existing wallet private key')
  .option('--type <type>', 'Wallet type: EVM or SOL (default: prompts)')
  .option('--address <address>', 'Wallet address (optional, derived from key)')
  .example('orderly wallet-import --type EVM')
  .example('orderly wallet-import --type SOL')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void walletImport(
      options.type as WalletType,
      normalizeAddress(options.address),
      undefined,
      network
    );
  });

cli
  .command('wallet-list', 'List all stored wallets')
  .example('orderly wallet-list')
  .example('orderly wallet-list --network testnet')
  .action((options) => {
    const network = options.network as Network | undefined;
    void walletList(network);
  });

cli
  .command(
    'wallet-show [address]',
    'Show wallet info (address required for AI/scripts, prompts if omitted)'
  )
  .example('orderly wallet-show')
  .example('orderly wallet-show 0x1234...')
  .action((address, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void walletShow(normalizeAddress(address), network);
  });

cli
  .command(
    'wallet-logout [address]',
    'Remove wallet from keychain (address required for AI/scripts, prompts if omitted)'
  )
  .example('orderly wallet-logout')
  .example('orderly wallet-logout 0x1234...')
  .action((address, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void walletLogout(normalizeAddress(address), network);
  });

cli
  .command('wallet-register', 'Register an Orderly account with your wallet (Step 2 of setup)')
  .option(
    '--broker-id <id>',
    'Broker ID, e.g., "demo" (required for AI/scripts, prompts if omitted)'
  )
  .option('--address <address>', 'Wallet address (required for AI/scripts, prompts if omitted)')
  .example('orderly wallet-register --broker-id demo')
  .example('orderly wallet-register --broker-id demo --address 0x1234...')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void walletRegister(options.brokerId, normalizeAddress(options.address), network);
  });

cli
  .command('wallet-add-key', 'Add Orderly API key for trading (Step 3 of setup)')
  .option('--broker-id <id>', 'Broker ID (required for AI/scripts, prompts if omitted)')
  .option('--address <address>', 'Wallet address (required for AI/scripts, prompts if omitted)')
  .option(
    '--scope <scope>',
    'Key scopes: read,trading,asset (required for AI/scripts, prompts if omitted)'
  )
  .example('orderly wallet-add-key --broker-id demo')
  .example('orderly wallet-add-key --broker-id demo --scope read,trading')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void walletAddKey(
      options.brokerId,
      normalizeAddress(options.address),
      normalizeScope(options.scope),
      network
    );
  });

// Auth commands - For users with existing API keys
cli
  .command(
    'auth-import [private-key]',
    'Import existing Ed25519 API key (for users who already have one)'
  )
  .option('--account <id>', 'Orderly account ID')
  .example('orderly auth-import <base64-key> --account 12345')
  .action((privateKey, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void importKey(privateKey, options.account, network);
  });

cli
  .command('auth-list', 'List all stored API keys (public keys only)')
  .example('orderly auth-list')
  .action((options) => {
    const network = options.network as Network | undefined;
    void list(network);
  });

cli
  .command('auth-show [account-id]', 'Show public key for an account')
  .example('orderly auth-show')
  .example('orderly auth-show 12345')
  .action((accountId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void show(accountId, network);
  });

cli
  .command('auth-logout [account-id]', 'Remove API key from keychain')
  .example('orderly auth-logout')
  .example('orderly auth-logout 12345')
  .action((accountId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void logout(accountId, network);
  });

cli
  .command('auth-export-key [account-id]', 'Export Ed25519 private key (requires interactive TTY)')
  .example('orderly auth-export-key')
  .action((accountId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void exportKey(accountId, network);
  });

// Account commands
cli
  .command('account-info', 'Get account information')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly account-info')
  .example('orderly account-info --account 0x1e6b...')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void info(normalizeAccountId(options.account), network);
  });

cli
  .command('account-balance', 'Get account balances')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly account-balance')
  .example('orderly account-balance --account 0x1e6b...')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void balance(normalizeAccountId(options.account), network);
  });

// Trading commands
cli
  .command('order-place <symbol> <side> <type> <quantity>', 'Place a new order')
  .option('--price <price>', 'Order price (required for LIMIT orders)')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly order-place PERP_ETH_USDC BUY MARKET 0.01')
  .example('orderly order-place PERP_ETH_USDC SELL LIMIT 0.01 --price 3500')
  .example('orderly order-place PERP_BTC_USDC BUY MARKET 0.001')
  .action((symbol, side, type, quantity, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void place(
      symbol,
      side,
      type,
      quantity,
      options.price,
      normalizeAccountId(options.account),
      network
    );
  });

cli
  .command('order-cancel <order-id>', 'Cancel an order')
  .option('--symbol <symbol>', 'Symbol of the order')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly order-cancel 123456 --symbol PERP_ETH_USDC')
  .action((orderId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void cancel(orderId, options.symbol, normalizeAccountId(options.account), network);
  });

cli
  .command('order-edit <order-id>', 'Edit a pending order')
  .option('--symbol <symbol>', 'Symbol of the order (required)')
  .option('--price <price>', 'New order price')
  .option('--quantity <quantity>', 'New order quantity')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly order-edit 123456 --symbol PERP_ETH_USDC --price 3500')
  .example('orderly order-edit 123456 --symbol PERP_ETH_USDC --quantity 0.02')
  .action((orderId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void edit(
      orderId,
      options.symbol,
      options.price,
      options.quantity,
      normalizeAccountId(options.account),
      network
    );
  });

cli
  .command('order-cancel-all', 'Cancel all orders')
  .option('--symbol <symbol>', 'Filter by symbol (optional)')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly order-cancel-all')
  .example('orderly order-cancel-all --symbol PERP_ETH_USDC')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void cancelAll(options.symbol, normalizeAccountId(options.account), network);
  });

cli
  .command('order-list', 'List orders')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly order-list')
  .example('orderly order-list --symbol PERP_ETH_USDC')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void listOrders(options.symbol, normalizeAccountId(options.account), network);
  });

cli
  .command('batch-order-place <orders>', 'Place multiple orders (max 10)')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('# From JSON string:')
  .example(
    'orderly batch-order-place \'[{"symbol":"PERP_ETH_USDC","order_type":"LIMIT","side":"BUY","order_quantity":"0.01","order_price":"2000"}]\''
  )
  .example('# From file:')
  .example('orderly batch-order-place orders.json')
  .action((orders, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void batchPlace(orders, normalizeAccountId(options.account), network);
  });

cli
  .command('batch-order-cancel <order-ids...>', 'Cancel multiple orders by IDs')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly batch-order-cancel 123 456 789')
  .action((orderIds, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const ids = Array.isArray(orderIds) ? orderIds : [orderIds];
    void batchCancel(ids, normalizeAccountId(options.account), network);
  });

cli
  .command('positions-list', 'List open positions')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly positions-list')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void listPositions(normalizeAccountId(options.account), network);
  });

cli
  .command('positions-close <symbol>', 'Close a position')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly positions-close PERP_ETH_USDC')
  .action((symbol, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void closePosition(symbol, normalizeAccountId(options.account), network);
  });

cli
  .command('positions-history', 'Get position history')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--start-t <timestamp>', 'Start timestamp (Unix ms)')
  .option('--end-t <timestamp>', 'End timestamp (Unix ms)')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly positions-history')
  .example('orderly positions-history --symbol PERP_ETH_USDC')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const startT = options.startT ? parseInt(options.startT, 10) : undefined;
    const endT = options.endT ? parseInt(options.endT, 10) : undefined;
    void positionHistory(
      options.symbol,
      startT,
      endT,
      normalizeAccountId(options.account),
      network
    );
  });
cli
  .command('leverage <symbol> [value]', 'Get or set leverage for a symbol')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly leverage PERP_ETH_USDC')
  .example('orderly leverage PERP_ETH_USDC 10')
  .action((symbol, value, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const leverageValue = value !== undefined ? parseFloat(value) : undefined;
    void getOrSetLeverage(symbol, leverageValue, normalizeAccountId(options.account), network);
  });

cli
  .command('trades', 'Get trade history')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--start-t <timestamp>', 'Start timestamp (Unix ms)')
  .option('--end-t <timestamp>', 'End timestamp (Unix ms)')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly trades')
  .example('orderly trades --symbol PERP_ETH_USDC')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const startT = options.startT ? parseInt(options.startT, 10) : undefined;
    const endT = options.endT ? parseInt(options.endT, 10) : undefined;
    void listTrades(options.symbol, startT, endT, normalizeAccountId(options.account), network);
  });

cli
  .command(
    'algo-order-place <symbol> <side> <algoType> <quantity>',
    'Place an algo order (STOP, TP_SL, TRAILING_STOP, BRACKET)'
  )
  .option('--trigger-price <price>', 'Trigger price (required for STOP/TP_SL)')
  .option(
    '--callback-rate <rate>',
    'Callback rate as decimal, e.g. 0.05 for 5% (required for TRAILING_STOP)'
  )
  .option('--order-price <price>', 'Order price (for limit orders)')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly algo-order-place PERP_ETH_USDC SELL STOP 0.01 --trigger-price 2000')
  .example('orderly algo-order-place PERP_ETH_USDC SELL TP_SL 0.01 --trigger-price 2500')
  .example('orderly algo-order-place PERP_ETH_USDC SELL TRAILING_STOP 0.01 --callback-rate 0.05')
  .action((symbol, side, algoType, quantity, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void placeAlgoOrder(
      symbol,
      side,
      algoType,
      quantity,
      options.triggerPrice,
      options.callbackRate,
      options.orderPrice,
      normalizeAccountId(options.account),
      network
    );
  });

cli
  .command('algo-order-cancel <order-id>', 'Cancel an algo order')
  .option('--symbol <symbol>', 'Symbol of the order (required)')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly algo-order-cancel 123456 --symbol PERP_ETH_USDC')
  .action((orderId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void cancelAlgoOrder(orderId, options.symbol, normalizeAccountId(options.account), network);
  });

cli
  .command('algo-order-cancel-all', 'Cancel all algo orders')
  .option('--symbol <symbol>', 'Filter by symbol (optional)')
  .option('--algo-type <type>', 'Filter by algo type: STOP, TP_SL, TRAILING_STOP, BRACKET')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly algo-order-cancel-all')
  .example('orderly algo-order-cancel-all --symbol PERP_ETH_USDC')
  .example('orderly algo-order-cancel-all --algo-type STOP')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void cancelAllAlgoOrders(
      options.symbol,
      options.algoType,
      normalizeAccountId(options.account),
      network
    );
  });

cli
  .command('algo-order-list', 'List algo orders')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly algo-order-list')
  .example('orderly algo-order-list --symbol PERP_ETH_USDC')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void listAlgoOrders(options.symbol, normalizeAccountId(options.account), network);
  });

cli
  .command('funding-history', 'Get funding fee history')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--start-t <timestamp>', 'Start timestamp (ms)')
  .option('--end-t <timestamp>', 'End timestamp (ms)')
  .option('--account <id>', 'Account ID (uses default if not set)')
  .example('orderly funding-history')
  .example('orderly funding-history --symbol PERP_ETH_USDC')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const startT = options.startT ? parseInt(options.startT, 10) : undefined;
    const endT = options.endT ? parseInt(options.endT, 10) : undefined;
    void fundingHistory(options.symbol, startT, endT, normalizeAccountId(options.account), network);
  });

// Market data commands (public, no auth)
cli
  .command('market-price <symbol>', 'Get current market price (no auth required)')
  .example('orderly market-price PERP_ETH_USDC')
  .example('orderly market-price PERP_BTC_USDC')
  .action((symbol, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getPrice(symbol, network);
  });

cli
  .command('market-orderbook <symbol>', 'Get orderbook (no auth required)')
  .example('orderly market-orderbook PERP_ETH_USDC')
  .action((symbol, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getOrderbook(symbol, network);
  });

cli
  .command('symbols', 'List all available trading symbols (no auth required)')
  .option('--info', 'Show detailed order rules')
  .example('orderly symbols')
  .example('orderly symbols --info')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getSymbols(options.info, network);
  });

// Testnet faucet
cli
  .command('faucet-usdc <address>', 'Get test USDC from faucet (testnet only)')
  .option('--broker-id <id>', 'Broker ID (required)')
  .option('--chain-id <id>', 'Chain ID for EVM: 421614 (Arbitrum Sepolia), 84532 (Base Sepolia)')
  .example('# EVM (Arbitrum Sepolia):')
  .example('orderly faucet-usdc 0x1234... --broker-id demo --chain-id 421614')
  .example('# Solana:')
  .example('orderly faucet-usdc <sol-address> --broker-id demo')
  .action((address, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const chainId = options.chainId ? String(options.chainId) : undefined;
    void faucetUsdc(requireAddress(address), options.brokerId, chainId, network);
  });

// Asset commands
cli
  .command('chains', 'List supported chains (no auth required)')
  .example('orderly chains')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getChains(network);
  });

cli
  .command('tokens', 'List supported tokens (no auth required)')
  .example('orderly tokens')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getTokens(network);
  });

cli
  .command('deposit-info <token> <chain-id>', 'Get deposit info for a token')
  .example('orderly deposit-info USDC 421614')
  .action((token, chainId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void depositInfo(token, Number(chainId), network);
  });

cli
  .command('withdraw <token> <amount> <receiver> <chain-id>', 'Prepare withdrawal')
  .option('--broker-id <id>', 'Broker ID', { default: 'demo' })
  .option('--account <id>', 'Account ID')
  .example('orderly withdraw USDC 100 0x1234... 421614 --broker-id demo')
  .action((token, amount, receiver, chainId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void withdraw(
      token,
      amount,
      receiver,
      Number(chainId),
      options.brokerId,
      normalizeAccountId(options.account),
      network
    );
  });

cli
  .command(
    'withdraw-submit <token> <amount> <receiver> <chain-id> <signature>',
    'Submit signed withdrawal'
  )
  .option('--broker-id <id>', 'Broker ID', { default: 'demo' })
  .option('--account <id>', 'Account ID')
  .action((token, amount, receiver, chainId, signature, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void withdrawSubmit(
      token,
      amount,
      receiver,
      Number(chainId),
      options.brokerId,
      signature,
      normalizeAccountId(options.account),
      network
    );
  });

cli
  .command('asset-history', 'Get asset deposit/withdraw history')
  .option('--token <token>', 'Filter by token')
  .option('--side <side>', 'Filter by side: DEPOSIT or WITHDRAW')
  .option('--account <id>', 'Account ID')
  .example('orderly asset-history')
  .example('orderly asset-history --side DEPOSIT')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void assetHistory(options.token, options.side, normalizeAccountId(options.account), network);
  });

try {
  cli.parse();
} catch (error) {
  if (error instanceof Error && error.name === 'CACError') {
    const message = error.message;
    const match = message.match(/missing required args for command `(.+)`/);
    if (match) {
      const commandName = match[1];
      console.error(kleur.red(`Error: ${message}`));
      console.error();
      console.error(kleur.yellow('Usage examples:'));
      console.error(kleur.cyan(`  orderly ${commandName} --help`));
      process.exit(1);
    }
  }
  throw error;
}
