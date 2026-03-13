#!/usr/bin/env node
import { cac } from 'cac';
import kleur from 'kleur';
import { init, importKey, list, logout, show } from './commands/auth.js';
import { info, balance } from './commands/account.js';
import { place, cancel, listOrders } from './commands/order.js';
import { listPositions, closePosition } from './commands/positions.js';
import { getPrice, getOrderbook } from './commands/market.js';
import { faucetUsdc } from './commands/faucet.js';
import {
  walletImport,
  walletList,
  walletShow,
  walletLogout,
  walletRegister,
  walletAddKey,
} from './commands/wallet.js';
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
    void faucetUsdc(requireAddress(address), options.brokerId, options.chainId, network);
  });

cli
  .command('wallet-import', 'Import an EVM or Solana wallet private key')
  .option('--type <type>', 'Wallet type (EVM or SOL)')
  .option('--address <address>', 'Wallet address (optional, will be derived from private key)')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void walletImport(
      options.type as WalletType,
      normalizeAddress(options.address),
      undefined,
      network
    );
  });

cli.command('wallet-list', 'List all stored wallet keys').action((options) => {
  const network = options.network as Network | undefined;
  void walletList(network);
});

cli.command('wallet-show [address]', 'Show wallet info').action((address, options) => {
  const network = (options.network as Network) || getDefaultNetwork();
  void walletShow(normalizeAddress(address), network);
});

cli.command('wallet-logout [address]', 'Remove stored wallet').action((address, options) => {
  const network = (options.network as Network) || getDefaultNetwork();
  void walletLogout(normalizeAddress(address), network);
});

cli
  .command('wallet-register', 'Register an Orderly account with your wallet')
  .option('--broker-id <id>', 'Broker ID')
  .option('--address <address>', 'Wallet address (optional, will prompt if not provided)')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void walletRegister(options.brokerId, normalizeAddress(options.address), network);
  });

cli
  .command('wallet-add-key', 'Add an Orderly API key for trading')
  .option('--broker-id <id>', 'Broker ID')
  .option('--address <address>', 'Wallet address (optional, will prompt if not provided)')
  .option('--scope <scope>', 'Key scopes (comma-separated: read,trading,asset)')
  .action((options) => {
    const network = (options.network as Network) || getDefaultNetwork();
    void walletAddKey(options.brokerId, normalizeAddress(options.address), options.scope, network);
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
      console.error(kleur.cyan(`  orderly ${commandName}`));
      console.error();
      console.error(kleur.dim('Run the following for more help:'));
      console.error(kleur.cyan(`  orderly ${commandName} --help`));
      process.exit(1);
    }
  }
  throw error;
}
