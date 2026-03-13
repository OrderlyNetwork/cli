#!/usr/bin/env node
import { cac } from 'cac';
import { init, importKey, list, logout, show } from './commands/auth.js';
import { info, balance } from './commands/account.js';
import { place, cancel, listOrders } from './commands/order.js';
import { listPositions, closePosition } from './commands/positions.js';
import { getPrice, getOrderbook } from './commands/market.js';
import { faucetUsdc } from './commands/faucet.js';
import { getDefaultNetwork } from './lib/config.js';
import { Network } from './types.js';

const cli = cac('orderly');

cli.version('0.1.0').help();

cli.option('--network <network>', 'Network to use (mainnet or testnet)', {
  default: getDefaultNetwork(),
});

cli
  .command('auth-init', 'Initialize authentication - generate and store Ed25519 keypair')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void init(network);
  });

cli
  .command('auth-import [private-key]', 'Import an existing Ed25519 private key')
  .option('--account <id>', 'Account ID to associate with the key')
  .action((privateKey, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void importKey(privateKey, options.account, network);
  });

cli.command('auth-list', 'List all stored account keys (public keys only)').action((options) => {
  const network = options.network as Network | undefined;
  void list(network);
});

cli
  .command('auth-show [account-id]', 'Show public key for an account')
  .action((accountId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void show(accountId, network);
  });

cli
  .command('auth-logout [account-id]', 'Remove stored key for an account')
  .action((accountId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void logout(accountId, network);
  });

cli.command('account-info [account-id]', 'Get account information').action((accountId, options) => {
  const network = (options.network as Network) || getDefaultNetwork();
  void info(accountId, network);
});

cli.command('account-balance [account-id]', 'Get account balances').action((accountId, options) => {
  const network = (options.network as Network) || getDefaultNetwork();
  void balance(accountId, network);
});

cli
  .command('order-place <symbol> <side> <type> <quantity>', 'Place a new order')
  .option('--price <price>', 'Order price (required for LIMIT orders)')
  .option('--account <id>', 'Account ID to use')
  .action((symbol, side, type, quantity, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void place(symbol, side, type, quantity, options.price, options.account, network);
  });

cli
  .command('order-cancel <order-id>', 'Cancel an order')
  .option('--account <id>', 'Account ID to use')
  .action((orderId, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void cancel(orderId, options.account, network);
  });

cli
  .command('order-list', 'List orders')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--account <id>', 'Account ID to use')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void listOrders(options.symbol, options.account, network);
  });

cli
  .command('positions-list', 'List open positions')
  .option('--account <id>', 'Account ID to use')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void listPositions(options.account, network);
  });

cli
  .command('positions-close <symbol>', 'Close a position')
  .option('--account <id>', 'Account ID to use')
  .action((symbol, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void closePosition(symbol, options.account, network);
  });

cli
  .command('market-price <symbol>', 'Get current market price (public endpoint)')
  .action((symbol, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getPrice(symbol, network);
  });

cli
  .command('market-orderbook <symbol>', 'Get orderbook (public endpoint)')
  .action((symbol, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void getOrderbook(symbol, network);
  });

cli
  .command('faucet-usdc <address>', 'Get test USDC from faucet (testnet only)')
  .option('--broker-id <id>', 'Broker ID (required)')
  .option('--chain-id <id>', 'Chain ID for EVM (not needed for Solana)')
  .action((address, options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void faucetUsdc(address, options.brokerId, options.chainId, network);
  });

cli.parse();
