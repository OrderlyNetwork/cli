#!/usr/bin/env node
import { cac } from 'cac';
import kleur from 'kleur';
import { importKey, list, logout, show, exportKey, cleanup } from './commands/auth.js';
import { info, balance, statistics } from './commands/account.js';
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
import {
  getPrice,
  getOrderbook,
  getSymbols,
  getKline,
  getMarketTrades,
  getFundingRates,
} from './commands/market.js';
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
import { getChains, getTokens, depositInfo, withdraw, assetHistory } from './commands/assets.js';
import { getOrSetLeverage } from './commands/leverage.js';
import { listTrades } from './commands/trades.js';
import {
  placeAlgoOrder,
  cancelAlgoOrder,
  cancelAllAlgoOrders,
  listAlgoOrders,
  editAlgoOrder,
} from './commands/algo.js';
import { fundingHistory } from './commands/funding.js';
import { settlePnl, settlePnlHistory } from './commands/settle.js';
import { info as referralInfo } from './commands/referral.js';
import { distributionHistory, volumeStats } from './commands/stats.js';
import { inbox, inboxUnread } from './commands/notification.js';
import { getDefaultNetwork } from './lib/config.js';
import { Network, WalletType } from './types.js';
import { OutputFormat, error } from './lib/output.js';

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
    error('Hex addresses must be quoted to prevent parsing as numbers.', [
      'Example: --address "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"',
    ]);
  }
  return str;
}

function requireAddress(address: unknown): string {
  const str = String(address);
  if (typeof address === 'number' || str.includes('e+') || str.includes('e-')) {
    const raw = findRawAddress('address');
    if (raw) return raw;
    error('Hex addresses must be quoted to prevent parsing as numbers.', [
      'Example: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"',
    ]);
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
    error('Hex account IDs must be quoted to prevent parsing as numbers.', [
      'Example: --account "0x1e6b18f967e262ea4ee8a1efab67c578bcc45cdcfd435c15b6913dcf14d0217e"',
    ]);
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
   ${kleur.green('orderly faucet-usdc <address> --chain-id 421614')}

4. Add API key for trading:
   ${kleur.green('orderly wallet-add-key')}

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
  auth-import, auth-list, auth-show, auth-logout, auth-cleanup, auth-export-key

${kleur.yellow('Trading:')}
  order-place, order-cancel, order-edit, order-cancel-all, order-list
  batch-order-place, batch-order-cancel
  algo-order-place, algo-order-cancel, algo-order-cancel-all, algo-order-edit, algo-order-list
  positions-list, positions-close, positions-history
  leverage, trades

${kleur.yellow('Account:')}
  account-info, account-balance, account-statistics

${kleur.yellow('Market Data:')}
  market-price, market-orderbook, market-trades, funding-rates, kline, symbols

${kleur.yellow('Assets:')}
  chains, tokens, deposit-info, withdraw, asset-history, funding-history

${kleur.yellow('PnL:')}
  settle-pnl, settle-pnl-history

${kleur.yellow('Referral:')}
  referral-info

${kleur.yellow('Stats & Notifications:')}
  distribution-history, volume-stats, notification-inbox, notification-unread

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
  })
  .option('--csv', 'Output as CSV instead of JSON (for list data)')
  .option('--pretty', 'Pretty-print JSON output (2-space indent)');

function getFormat(options: { csv?: boolean }): OutputFormat {
  return options.csv ? 'csv' : 'json';
}

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
    void walletList(network, getFormat(options));
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
  .option('--address <address>', 'Wallet address (required for AI/scripts, prompts if omitted)')
  .option('--scope <scope>', 'Key scopes: read,trading,asset (default: read,trading)')
  .example('orderly wallet-add-key')
  .example('orderly wallet-add-key --scope read,trading')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void walletAddKey(normalizeAddress(options.address), normalizeScope(options.scope), network);
  });

// Auth commands - For users with existing API keys
cli
  .command(
    'auth-import [private-key]',
    'Import existing Ed25519 API key (for users who already have one)'
  )
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly auth-import <base64-key> --account 12345')
  .action((privateKey, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void importKey(privateKey, options.account, network);
  });

cli
  .command('auth-list', 'List all stored API keys (public keys only)')
  .option('--ids', 'Output only account IDs, one per line (for scripting/piping)')
  .example('orderly auth-list')
  .example('orderly auth-list --ids')
  .example('orderly auth-list --network testnet --ids')
  .action((options) => {
    const network = options.network as Network | undefined;
    void list(network, getFormat(options), options.ids || false);
  });

cli
  .command('auth-show', 'Show public key for an account')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly auth-show')
  .example('orderly auth-show --account 0x1e6b...')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void show(
      options.account ? normalizeAccountId(options.account) : undefined,
      network,
      getFormat(options)
    );
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
  .command('auth-cleanup', 'Remove all stored API keys for a network')
  .example('orderly auth-cleanup')
  .example('orderly auth-cleanup --network testnet')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void cleanup(network);
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
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly account-info')
  .example('orderly account-info --account 0x1e6b...')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void info(normalizeAccountId(options.account), network, getFormat(options));
  });

cli
  .command('account-balance', 'Get account balances')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly account-balance')
  .example('orderly account-balance --account 0x1e6b...')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void balance(normalizeAccountId(options.account), network, getFormat(options));
  });

cli
  .command(
    'account-statistics',
    'Get account trading statistics (volume, fees, days since registration)'
  )
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly account-statistics')
  .example('orderly account-statistics --account 0x1e6b...')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void statistics(normalizeAccountId(options.account), network, getFormat(options));
  });

// Trading commands
cli
  .command(
    'order-place <symbol> <side> <type> <quantity>',
    'Place a new order. Types: MARKET, LIMIT, IOC, FOK, POST_ONLY, ASK (market sell), BID (market buy)'
  )
  .option('--price <price>', 'Order price (required for LIMIT, IOC, FOK, POST_ONLY)')
  .option('--client-order-id <id>', 'Custom client order ID (optional)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly order-place PERP_ETH_USDC BUY MARKET 0.01')
  .example('orderly order-place PERP_ETH_USDC SELL LIMIT 0.01 --price 3500')
  .example('orderly order-place PERP_ETH_USDC BUY IOC 0.01 --price 2100')
  .example('orderly order-place PERP_ETH_USDC SELL FOK 0.01 --price 2100')
  .example('orderly order-place PERP_ETH_USDC BUY POST_ONLY 0.01 --price 2000')
  .example('orderly order-place PERP_ETH_USDC SELL ASK 0.01')
  .example('orderly order-place PERP_ETH_USDC BUY BID 0.01')
  .example('orderly order-place PERP_ETH_USDC BUY MARKET 0.01 --client-order-id my-order-123')
  .action((symbol, side, type, quantity, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void place(
      symbol,
      side,
      type,
      quantity,
      options.price,
      options.clientOrderId,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('order-cancel <order-id>', 'Cancel an order')
  .option('--symbol <symbol>', 'Symbol of the order (auto-fetched if not provided)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly order-cancel 123456')
  .example('orderly order-cancel 123456 --symbol PERP_ETH_USDC')
  .action((orderId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void cancel(
      orderId,
      options.symbol,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('order-edit <order-id>', 'Edit a pending order (only specify what to change)')
  .option('--symbol <symbol>', 'Symbol of the order (auto-fetched if not provided)')
  .option('--price <price>', 'New order price')
  .option('--quantity <quantity>', 'New order quantity')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly order-edit 123456 --price 3500')
  .example('orderly order-edit 123456 --quantity 0.02')
  .example('orderly order-edit 123456 --price 3500 --quantity 0.01')
  .action((orderId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void edit(
      orderId,
      options.symbol,
      options.price,
      options.quantity,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('order-cancel-all', 'Cancel all orders')
  .option('--symbol <symbol>', 'Filter by symbol (optional)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly order-cancel-all')
  .example('orderly order-cancel-all --symbol PERP_ETH_USDC')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void cancelAll(
      options.symbol,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('order-list', 'List orders')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--status <status>', 'Filter by status: NEW, FILLED, CANCELLED, INCOMPLETE, COMPLETED')
  .option('--page <n>', 'Page number (default: 1)')
  .option('--size <n>', 'Page size (default: 25, max: 500)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly order-list')
  .example('orderly order-list --symbol PERP_ETH_USDC')
  .example('orderly order-list --status INCOMPLETE')
  .example('orderly order-list --status FILLED --symbol PERP_ETH_USDC')
  .example('orderly order-list --page 2 --size 50')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const page = options.page ? parseInt(options.page, 10) : undefined;
    const size = options.size ? parseInt(options.size, 10) : undefined;
    void listOrders(
      options.symbol,
      options.status,
      page,
      size,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('batch-order-place <orders>', 'Place multiple orders (max 10)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('# Using CLI-style field names (recommended):')
  .example(
    'orderly batch-order-place \'[{"symbol":"PERP_ETH_USDC","type":"LIMIT","side":"BUY","quantity":"0.01","price":"2000"}]\''
  )
  .example('# Using API field names (also accepted):')
  .example(
    'orderly batch-order-place \'[{"symbol":"PERP_ETH_USDC","order_type":"LIMIT","side":"BUY","order_quantity":"0.01","order_price":"2000"}]\''
  )
  .example('# From file:')
  .example('orderly batch-order-place orders.json')
  .action((orders, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void batchPlace(orders, normalizeAccountId(options.account), network, getFormat(options));
  });

cli
  .command('batch-order-cancel <order-ids...>', 'Cancel multiple orders by IDs')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly batch-order-cancel 123 456 789')
  .action((orderIds, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const ids = Array.isArray(orderIds) ? orderIds : [orderIds];
    void batchCancel(ids, normalizeAccountId(options.account), network, getFormat(options));
  });

cli
  .command('positions-list', 'List open positions')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly positions-list')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void listPositions(normalizeAccountId(options.account), network, getFormat(options));
  });

cli
  .command('positions-close <symbol>', 'Close a position')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly positions-close PERP_ETH_USDC')
  .action((symbol, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void closePosition(symbol, normalizeAccountId(options.account), network, getFormat(options));
  });

cli
  .command('market-orderbook <symbol>', 'Get orderbook snapshot')
  .example('orderly market-orderbook PERP_ETH_USDC')
  .action((symbol, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getOrderbook(symbol, network, getFormat(options));
  });

cli
  .command('positions-history', 'Get position history')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--start-t <timestamp>', 'Start timestamp (Unix ms)')
  .option('--end-t <timestamp>', 'End timestamp (Unix ms)')
  .option('--page <n>', 'Page number (default: 1)')
  .option('--size <n>', 'Page size (default: 25)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly positions-history')
  .example('orderly positions-history --symbol PERP_ETH_USDC')
  .example('orderly positions-history --page 2 --size 50')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const startT = options.startT ? parseInt(options.startT, 10) : undefined;
    const endT = options.endT ? parseInt(options.endT, 10) : undefined;
    const page = options.page ? parseInt(options.page, 10) : undefined;
    const size = options.size ? parseInt(options.size, 10) : undefined;
    void positionHistory(
      options.symbol,
      startT,
      endT,
      page,
      size,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });
cli
  .command('leverage <symbol> [value]', 'Get or set leverage for a symbol')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly leverage PERP_ETH_USDC')
  .example('orderly leverage PERP_ETH_USDC 10')
  .action((symbol, value, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const leverageValue = value !== undefined ? parseFloat(value) : undefined;
    void getOrSetLeverage(
      symbol,
      leverageValue,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('trades', 'Get trade history')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--start-t <timestamp>', 'Start timestamp (Unix ms)')
  .option('--end-t <timestamp>', 'End timestamp (Unix ms)')
  .option('--page <n>', 'Page number (default: 1)')
  .option('--size <n>', 'Page size (default: 25, max: 500)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly trades')
  .example('orderly trades --symbol PERP_ETH_USDC')
  .example('orderly trades --page 2 --size 50')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const startT = options.startT ? parseInt(options.startT, 10) : undefined;
    const endT = options.endT ? parseInt(options.endT, 10) : undefined;
    const page = options.page ? parseInt(options.page, 10) : undefined;
    const size = options.size ? parseInt(options.size, 10) : undefined;
    void listTrades(
      options.symbol,
      startT,
      endT,
      page,
      size,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command(
    'algo-order-place <symbol> <side> <algoType> <quantity>',
    'Place an algo order (STOP, TP_SL, POSITIONAL_TP_SL, TRAILING_STOP, BRACKET)'
  )
  .option('--trigger-price <price>', 'Trigger price (required for STOP)')
  .option(
    '--callback-rate <rate>',
    'Callback rate as decimal, e.g. 0.05 for 5% (required for TRAILING_STOP)'
  )
  .option('--order-price <price>', 'Order price (for limit orders)')
  .option('--tp-trigger-price <price>', 'Take-profit trigger price (for TP_SL/POSITIONAL_TP_SL)')
  .option('--tp-price <price>', 'Take-profit order price (optional, MARKET if not set)')
  .option('--sl-trigger-price <price>', 'Stop-loss trigger price (for TP_SL/POSITIONAL_TP_SL)')
  .option('--sl-price <price>', 'Stop-loss order price (optional, MARKET if not set)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly algo-order-place PERP_ETH_USDC SELL STOP 0.01 --trigger-price 2000')
  .example(
    'orderly algo-order-place PERP_ETH_USDC SELL TP_SL 0.01 --tp-trigger-price 2500 --sl-trigger-price 1500'
  )
  .example(
    'orderly algo-order-place PERP_ETH_USDC SELL POSITIONAL_TP_SL 0 --tp-trigger-price 2500 --sl-trigger-price 1500'
  )
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
      options.tpTriggerPrice,
      options.tpPrice,
      options.slTriggerPrice,
      options.slPrice,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('algo-order-cancel <order-id>', 'Cancel an algo order')
  .option('--symbol <symbol>', 'Symbol of the order (auto-fetched if not provided)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly algo-order-cancel 123456')
  .example('orderly algo-order-cancel 123456 --symbol PERP_ETH_USDC')
  .action((orderId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void cancelAlgoOrder(
      orderId,
      options.symbol,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command(
    'algo-order-edit <order-id>',
    'Edit a pending algo order (only specify what to change: price, quantity, trigger-price, callback-rate)'
  )
  .option('--symbol <symbol>', 'Symbol of the order (auto-fetched if not provided)')
  .option('--price <price>', 'New order price')
  .option('--quantity <quantity>', 'New order quantity')
  .option('--trigger-price <price>', 'New trigger price')
  .option('--callback-rate <rate>', 'New callback rate as decimal, e.g. 0.05 for 5%')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly algo-order-edit 123456 --price 2500')
  .example('orderly algo-order-edit 123456 --quantity 0.02')
  .example('orderly algo-order-edit 123456 --trigger-price 1500')
  .example('orderly algo-order-edit 123456 --callback-rate 0.03')
  .action((orderId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void editAlgoOrder(
      orderId,
      options.symbol,
      options.price,
      options.quantity,
      options.triggerPrice,
      options.callbackRate,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('algo-order-cancel-all', 'Cancel all algo orders')
  .option('--symbol <symbol>', 'Filter by symbol (optional)')
  .option('--algo-type <type>', 'Filter by algo type: STOP, TP_SL, TRAILING_STOP, BRACKET')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly algo-order-cancel-all')
  .example('orderly algo-order-cancel-all --symbol PERP_ETH_USDC')
  .example('orderly algo-order-cancel-all --algo-type STOP')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void cancelAllAlgoOrders(
      options.symbol,
      options.algoType,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('algo-order-list', 'List algo orders')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--status <status>', 'Filter by status: NEW, CANCELLED, INCOMPLETE, COMPLETED')
  .option('--page <n>', 'Page number (default: 1)')
  .option('--size <n>', 'Page size (default: 25, max: 500)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly algo-order-list')
  .example('orderly algo-order-list --symbol PERP_ETH_USDC')
  .example('orderly algo-order-list --status INCOMPLETE')
  .example('orderly algo-order-list --page 2 --size 50')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const page = options.page ? parseInt(options.page, 10) : undefined;
    const size = options.size ? parseInt(options.size, 10) : undefined;
    void listAlgoOrders(
      options.symbol,
      options.status,
      page,
      size,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('funding-history', 'Get funding fee history')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--start-t <timestamp>', 'Start timestamp (ms)')
  .option('--end-t <timestamp>', 'End timestamp (ms)')
  .option('--page <n>', 'Page number (default: 1)')
  .option('--size <n>', 'Page size (default: 25)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly funding-history')
  .example('orderly funding-history --symbol PERP_ETH_USDC')
  .example('orderly funding-history --page 2 --size 50')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const startT = options.startT ? parseInt(options.startT, 10) : undefined;
    const endT = options.endT ? parseInt(options.endT, 10) : undefined;
    const page = options.page ? parseInt(options.page, 10) : undefined;
    const size = options.size ? parseInt(options.size, 10) : undefined;
    void fundingHistory(
      options.symbol,
      startT,
      endT,
      page,
      size,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('settle-pnl', 'Settle unrealized PnL into account balance')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly settle-pnl --account 0x1e6b...')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void settlePnl(normalizeAccountId(options.account), network, getFormat(options));
  });

cli
  .command('settle-pnl-history', 'Get on-chain PnL settlement history')
  .option('--page <n>', 'Page number (default: 1)')
  .option('--size <n>', 'Page size (default: 25)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly settle-pnl-history')
  .example('orderly settle-pnl-history --page 2 --size 50')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const page = options.page ? parseInt(options.page, 10) : undefined;
    const size = options.size ? parseInt(options.size, 10) : undefined;
    void settlePnlHistory(
      page,
      size,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('referral-info', 'Get referral information (referrer/referee stats and codes)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly referral-info')
  .example('orderly referral-info --account 0x1e6b...')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void referralInfo(normalizeAccountId(options.account), network, getFormat(options));
  });

cli
  .command('distribution-history', 'Get broker fee and referral rebate history')
  .option('--status <status>', 'Filter by status: CREATED, SPLIT, COMPLETED')
  .option('--type <type>', 'Filter by type: BROKER_FEE, REFEREE_REBATE, REFERRER_REBATE')
  .option('--start-t <timestamp>', 'Start timestamp (Unix ms)')
  .option('--end-t <timestamp>', 'End timestamp (Unix ms)')
  .option('--page <n>', 'Page number (default: 1)')
  .option('--size <n>', 'Page size (default: 25)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly distribution-history')
  .example('orderly distribution-history --type REFERRER_REBATE')
  .example('orderly distribution-history --status COMPLETED --page 2 --size 50')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const startT = options.startT ? parseInt(options.startT, 10) : undefined;
    const endT = options.endT ? parseInt(options.endT, 10) : undefined;
    const page = options.page ? parseInt(options.page, 10) : undefined;
    const size = options.size ? parseInt(options.size, 10) : undefined;
    void distributionHistory(
      options.status,
      options.type,
      startT,
      endT,
      page,
      size,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('volume-stats', 'Get perp trading volume statistics (today, 1d, 7d, 30d, YTD, LTD)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly volume-stats')
  .example('orderly volume-stats --account 0x1e6b...')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void volumeStats(normalizeAccountId(options.account), network, getFormat(options));
  });

cli
  .command('notification-inbox', 'List notification inbox messages')
  .option('--type <type>', 'Filter by type: TRADE or SYSTEM')
  .option('--page <n>', 'Page number (default: 1)')
  .option('--size <n>', 'Page size (default: 25)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly notification-inbox')
  .example('orderly notification-inbox --type TRADE')
  .example('orderly notification-inbox --page 2 --size 50')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const page = options.page ? parseInt(options.page, 10) : undefined;
    const size = options.size ? parseInt(options.size, 10) : undefined;
    void inbox(
      options.type,
      page,
      size,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

cli
  .command('notification-unread', 'Get unread notification count and messages')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly notification-unread')
  .example('orderly notification-unread --account 0x1e6b...')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void inboxUnread(normalizeAccountId(options.account), network, getFormat(options));
  });

cli
  .command('market-price <symbol>', 'Get current market price')
  .example('orderly market-price PERP_ETH_USDC')
  .example('orderly market-price PERP_BTC_USDC')
  .action((symbol, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getPrice(symbol, network, getFormat(options));
  });

cli
  .command(
    'symbols',
    'List trading symbols. Default: compact list (symbol, pair, prices). Use --info for full order rules (lot size, min notional, price tick, etc.)'
  )
  .option(
    '--info',
    'Show detailed per-symbol order rules instead of compact list (calls /v1/public/info instead of /v1/public/futures)'
  )
  .example('orderly symbols')
  .example('orderly symbols --csv')
  .example('orderly symbols --info')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getSymbols(options.info, network, getFormat(options));
  });

cli
  .command('kline <symbol> <type>', 'Get candlestick/kline data')
  .option('--limit <n>', 'Number of candles (max 1000)')
  .example('orderly kline PERP_ETH_USDC 1h')
  .example('orderly kline PERP_BTC_USDC 1d --limit 30')
  .action((symbol, type, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const limit = options.limit ? parseInt(options.limit, 10) : 100;
    void getKline(symbol, type, limit, network, getFormat(options));
  });

cli
  .command('market-trades <symbol>', 'Get recent public trades')
  .option('--limit <n>', 'Number of trades (default: 50)')
  .example('orderly market-trades PERP_ETH_USDC')
  .example('orderly market-trades PERP_BTC_USDC --limit 20')
  .action((symbol, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const limit = options.limit ? parseInt(options.limit, 10) : undefined;
    void getMarketTrades(symbol, limit, network, getFormat(options));
  });

cli
  .command('funding-rates', 'Get public funding rates for all symbols (no auth required)')
  .example('orderly funding-rates')
  .example('orderly funding-rates --network mainnet')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getFundingRates(network, getFormat(options));
  });

// Testnet faucet
cli
  .command('faucet-usdc <address>', 'Get test USDC from faucet (testnet only)')
  .option('--chain-id <id>', 'Chain ID for EVM: 421614 (Arbitrum Sepolia), 84532 (Base Sepolia)')
  .example('# EVM (Arbitrum Sepolia):')
  .example('orderly faucet-usdc 0x1234... --chain-id 421614')
  .example('# Solana:')
  .example('orderly faucet-usdc <sol-address>')
  .action((address, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const chainId = options.chainId ? String(options.chainId) : undefined;
    void faucetUsdc(requireAddress(address), chainId, network, getFormat(options));
  });

// Asset commands
cli
  .command('chains', 'List supported chains (no auth required)')
  .example('orderly chains')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getChains(network, getFormat(options));
  });

cli
  .command('tokens', 'List supported tokens (no auth required)')
  .example('orderly tokens')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getTokens(network, getFormat(options));
  });

cli
  .command('deposit-info <token> <chain-id>', 'Get deposit info for a token')
  .example('orderly deposit-info USDC 421614')
  .action((token, chainId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const format: OutputFormat = (options.csv as boolean) ? 'csv' : 'json';
    void depositInfo(token, Number(chainId), network, format);
  });

cli
  .command('withdraw <token> <receiver> <chain-id>', 'Withdraw tokens (auto-signs with wallet key)')
  .option('--amount <amount>', 'Amount to withdraw (human-readable, e.g. 10.5)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .option('--raw', 'Amount is in smallest units (default: false, use human-readable like 10.5)')
  .option(
    '--allow-cross-chain',
    'Allow cross-chain withdrawal (required when destination chain differs from deposit chain)'
  )
  .example('# Withdraw 10 USDC (human-readable amount)')
  .example('orderly withdraw USDC 0x1234... 421614 --amount 10')
  .example('# Withdraw 0.5 USDC')
  .example('orderly withdraw USDC 0x1234... 421614 --amount 0.5')
  .example('# Withdraw to Solana (50 USDC)')
  .example('orderly withdraw USDC <sol-address> 901901901 --amount 50')
  .example('# Use raw amount (10000000 = 10 USDC with 6 decimals)')
  .example('orderly withdraw USDC 0x1234... 421614 --amount 10000000 --raw')
  .example('# Withdraw to different chain (cross-chain)')
  .example('orderly withdraw USDC 0x1234... 84532 --amount 10 --allow-cross-chain')
  .action((token, receiver, chainId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    if (!options.amount) {
      error('Missing required option: --amount');
    }
    void withdraw(
      token,
      String(options.amount),
      receiver,
      parseInt(chainId, 10),
      normalizeAccountId(options.account),
      network,
      options.raw,
      options.allowCrossChain,
      getFormat(options)
    );
  });

cli
  .command('asset-history', 'Get asset deposit/withdraw history')
  .option('--token <token>', 'Filter by token')
  .option('--side <side>', 'Filter by side: DEPOSIT or WITHDRAW')
  .option(
    '--status <status>',
    'Filter by status: NEW, CONFIRM, PROCESSING, COMPLETED, FAILED, PENDING_REBALANCE'
  )
  .option('--page <n>', 'Page number (default: 1)')
  .option('--size <n>', 'Page size (default: 25)')
  .option('--account <id>', 'Account ID (auto-resolves if single account)')
  .example('orderly asset-history')
  .example('orderly asset-history --side DEPOSIT')
  .example('orderly asset-history --status PROCESSING')
  .example('orderly asset-history --page 2 --size 50')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    const page = options.page ? parseInt(options.page, 10) : undefined;
    const size = options.size ? parseInt(options.size, 10) : undefined;
    void assetHistory(
      options.token,
      options.side,
      options.status,
      page,
      size,
      normalizeAccountId(options.account),
      network,
      getFormat(options)
    );
  });

const rawArgs = process.argv.slice(2);

try {
  cli.parse();

  if (rawArgs.length > 0 && !rawArgs[0].startsWith('-')) {
    const commandPart = rawArgs[0];
    const matched = cli.commands.some(
      (c) =>
        c.name === commandPart ||
        (Array.isArray(c.aliasNames) && c.aliasNames.includes(commandPart))
    );
    if (
      !matched &&
      commandPart !== 'help' &&
      !rawArgs.includes('--help') &&
      !rawArgs.includes('-h') &&
      !rawArgs.includes('--version') &&
      !rawArgs.includes('-v')
    ) {
      const { error: outputError } = await import('./lib/output.js');
      outputError(`Unknown command: ${commandPart}`, [
        `Run ${kleur.cyan('orderly --help')} to see available commands.`,
      ]);
      process.exit(1);
    }
  }
} catch (err) {
  if (err instanceof Error && err.name === 'CACError') {
    const message = err.message;
    const match = message.match(/missing required args for command `(.+)`/);
    if (match) {
      const commandName = match[1];
      error(`${message}`, [`Usage examples:`, `  orderly ${commandName} --help`]);
    }
  }
  throw err;
}
