#!/usr/bin/env node
import { cac } from 'cac';
import { init, importKey, list, logout, show } from './commands/auth.js';
import { info, balance } from './commands/account.js';
import { place, cancel, listOrders } from './commands/order.js';
import { listPositions, closePosition } from './commands/positions.js';
import { getPrice, getOrderbook } from './commands/market.js';

const cli = cac('orderly');

cli.version('0.1.0').help();

cli
  .command('auth init', 'Initialize authentication - generate and store Ed25519 keypair')
  .action(init);

cli
  .command('auth import [private-key]', 'Import an existing Ed25519 private key')
  .option('--account <id>', 'Account ID to associate with the key')
  .action((privateKey, options) => importKey(privateKey, options.account));

cli.command('auth list', 'List all stored account keys (public keys only)').action(list);

cli.command('auth show [account-id]', 'Show public key for an account').action(show);

cli.command('auth logout [account-id]', 'Remove stored key for an account').action(logout);

cli.command('account info [account-id]', 'Get account information').action(info);

cli.command('account balance [account-id]', 'Get account balances').action(balance);

cli
  .command('order place <symbol> <side> <type> <quantity>', 'Place a new order')
  .option('--price <price>', 'Order price (required for LIMIT orders)')
  .option('--account <id>', 'Account ID to use')
  .action((symbol, side, type, quantity, options) =>
    place(symbol, side, type, quantity, options.price, options.account)
  );

cli
  .command('order cancel <order-id>', 'Cancel an order')
  .option('--account <id>', 'Account ID to use')
  .action((orderId, options) => cancel(orderId, options.account));

cli
  .command('order list', 'List orders')
  .option('--symbol <symbol>', 'Filter by symbol')
  .option('--account <id>', 'Account ID to use')
  .action((options) => listOrders(options.symbol, options.account));

cli
  .command('positions list', 'List open positions')
  .option('--account <id>', 'Account ID to use')
  .action((options) => listPositions(options.account));

cli
  .command('positions close <symbol>', 'Close a position')
  .option('--account <id>', 'Account ID to use')
  .action((symbol, options) => closePosition(symbol, options.account));

cli.command('market price <symbol>', 'Get current market price (public endpoint)').action(getPrice);

cli.command('market orderbook <symbol>', 'Get orderbook (public endpoint)').action(getOrderbook);

cli.parse();
