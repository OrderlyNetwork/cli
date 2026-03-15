import kleur from 'kleur';
import prompts from 'prompts';
import axios from 'axios';
import {
  WalletKeyPair,
  Network,
  WalletType,
  RegistrationMessage,
  AddKeyMessage,
} from '../types.js';
import {
  storeWalletKey,
  getWalletKey,
  deleteWalletKey,
  listWalletKeys,
  hasWalletKey,
  storeKey,
} from '../lib/keychain.js';
import {
  createWalletFromPrivateKey,
  isValidPrivateKey,
  normalizePrivateKey,
  signRegistration as signEVMRegistration,
  signAddKey as signEVMAddKey,
  generateEVMWallet,
} from '../lib/evm.js';
import {
  createSolanaWalletFromPrivateKey,
  signRegistration as signSolanaRegistration,
  signAddKey as signSolanaAddKey,
  getSolanaChainId,
  generateSolanaWallet,
} from '../lib/solana.js';
import { OrderlyClient } from '../lib/api.js';
import { setDefaultNetwork } from '../lib/config.js';
import { getPublicKeyBase58, generateKeyPair } from '../lib/crypto.js';

export async function walletCreate(
  walletType: WalletType | undefined,
  network: Network
): Promise<void> {
  console.log(kleur.cyan(`\n🔐 Create New Wallet (${network})\n`));

  let type: WalletType = walletType ?? 'EVM';
  if (!walletType) {
    const response = await prompts({
      type: 'select',
      name: 'type',
      message: 'Select wallet type',
      choices: [
        { title: 'EVM (Ethereum, Arbitrum, etc.)', value: 'EVM' },
        { title: 'Solana', value: 'SOL' },
      ],
    });
    if (!response.type) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    type = response.type;
  }

  let address: string;
  let privateKey: string;

  try {
    if (type === 'EVM') {
      const wallet = generateEVMWallet();
      address = wallet.address;
      privateKey = wallet.privateKey;
    } else {
      const wallet = generateSolanaWallet();
      address = wallet.address;
      privateKey = wallet.privateKey;
    }
  } catch (error) {
    console.error(kleur.red('Failed to generate wallet'), error);
    return;
  }

  const walletKeyPair: WalletKeyPair = {
    address,
    privateKey,
    walletType: type,
    network,
  };

  try {
    await storeWalletKey(address, network, walletKeyPair);
  } catch (error) {
    console.error(kleur.red('Failed to store wallet'), error);
    return;
  }

  console.log();
  console.log(kleur.green('✅ Wallet created successfully!'));
  console.log(kleur.dim(`Address: ${address}`));
  console.log(kleur.dim(`Type: ${type}`));
  console.log(kleur.dim(`Network: ${network}`));
  console.log();
  console.log(
    kleur.yellow('⚠️  Private key is stored in OS keychain and will never be shown again.')
  );
  console.log(kleur.dim('Make sure to back up your wallet if needed for external use.'));
}

export async function walletImport(
  walletType: WalletType | undefined,
  address: string | undefined,
  privateKey: string | undefined,
  network: Network
): Promise<void> {
  console.log(kleur.cyan(`\n🔑 Import Wallet (${network})\n`));

  let type: WalletType = walletType ?? 'EVM';
  if (!walletType) {
    const response = await prompts({
      type: 'select',
      name: 'type',
      message: 'Select wallet type',
      choices: [
        { title: 'EVM (Ethereum, Arbitrum, etc.)', value: 'EVM' },
        { title: 'Solana', value: 'SOL' },
      ],
    });
    if (!response.type) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    type = response.type;
  }

  let addr: string = address ?? '';
  let key: string = privateKey ?? '';

  if (!key) {
    const response = await prompts({
      type: 'password',
      name: 'privateKey',
      message: `Enter your ${type} private key`,
      validate: (value: string) => {
        if (value.length === 0) return 'Private key is required';
        if (type === 'EVM' && !isValidPrivateKey(value)) {
          return 'Invalid EVM private key format';
        }
        return true;
      },
    });
    if (!response.privateKey) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    key = response.privateKey.trim();
  }

  let walletAddress: string;
  try {
    if (type === 'EVM') {
      const wallet = createWalletFromPrivateKey(normalizePrivateKey(key));
      walletAddress = wallet.address;
    } else {
      const wallet = createSolanaWalletFromPrivateKey(key, network);
      walletAddress = wallet.address;
    }
  } catch (error) {
    console.log(
      kleur.red(`Invalid private key: ${error instanceof Error ? error.message : 'Unknown error'}`)
    );
    return;
  }

  if (addr && addr.toLowerCase() !== walletAddress.toLowerCase()) {
    console.log(kleur.red('Provided address does not match private key'));
    return;
  }
  addr = walletAddress;

  const existing = await hasWalletKey(addr, network);
  if (existing) {
    console.log(kleur.yellow(`Wallet already exists for ${addr} on ${network}`));
    const overwrite = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Overwrite existing wallet?',
      initial: false,
    });
    if (!overwrite.value) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
  }

  const walletKeyPair: WalletKeyPair = {
    address: addr,
    privateKey: key,
    walletType: type,
    network,
  };

  try {
    await storeWalletKey(addr, network, walletKeyPair);
  } catch (error) {
    console.error(kleur.red('Failed to store wallet'), error);
    return;
  }

  console.log();
  console.log(kleur.green('✅ Wallet imported successfully!'));
  console.log(kleur.dim(`Address: ${addr}`));
  console.log(kleur.dim(`Type: ${type}`));
}

export async function walletList(network: Network | undefined): Promise<void> {
  console.log(kleur.cyan('\n📋 Stored Wallets\n'));

  const wallets = await listWalletKeys();

  const filteredWallets = network ? wallets.filter((w) => w.network === network) : wallets;

  if (filteredWallets.length === 0) {
    console.log(kleur.yellow('No wallets stored. Run `orderly wallet-import` to get started.'));
    return;
  }

  for (const wallet of filteredWallets) {
    console.log(
      `${kleur.cyan(wallet.address)} ${kleur.dim(`[${wallet.network}]`)} ${kleur.dim(`(${wallet.walletType})`)}`
    );
  }
}

export async function walletShow(address: string | undefined, network: Network): Promise<void> {
  let addr = address;

  if (!addr) {
    const wallets = await listWalletKeys();
    const filteredWallets = wallets.filter((w) => w.network === network);

    if (filteredWallets.length === 0) {
      console.log(kleur.red(`No wallets found for ${network}.`));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'address',
      message: 'Select wallet',
      choices: filteredWallets.map((w) => ({
        title: `${w.address} (${w.walletType})`,
        value: w.address,
      })),
    });

    if (!response.address) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    addr = response.address;
  }

  if (!addr) {
    console.log(kleur.red('No address specified.'));
    return;
  }

  const wallet = await getWalletKey(addr, network);

  if (!wallet) {
    console.log(kleur.red(`No wallet found for ${addr} on ${network}`));
    return;
  }

  console.log(kleur.cyan('\n🔑 Wallet Info\n'));
  console.log(`Address:    ${kleur.white(wallet.address)}`);
  console.log(`Network:    ${kleur.white(wallet.network)}`);
  console.log(`Type:       ${kleur.white(wallet.walletType)}`);
  console.log(kleur.dim('\n(Private key is stored securely and cannot be displayed)'));
}

export async function walletLogout(address: string | undefined, network: Network): Promise<void> {
  console.log(kleur.cyan('\n🚪 Wallet Logout\n'));

  let addr = address;

  if (!addr) {
    const wallets = await listWalletKeys();
    const filteredWallets = wallets.filter((w) => w.network === network);

    if (filteredWallets.length === 0) {
      console.log(kleur.yellow(`No wallets stored for ${network}.`));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'address',
      message: 'Select wallet to logout',
      choices: filteredWallets.map((w) => ({
        title: `${w.address} (${w.walletType})`,
        value: w.address,
      })),
    });

    if (!response.address) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    addr = response.address;
  }

  if (!addr) {
    console.log(kleur.red('No address selected.'));
    return;
  }

  const confirm = await prompts({
    type: 'confirm',
    name: 'value',
    message: `Remove wallet ${addr} on ${network}?`,
    initial: false,
  });

  if (!confirm.value) {
    console.log(kleur.red('Cancelled.'));
    return;
  }

  try {
    const deleted = await deleteWalletKey(addr, network);
    if (deleted) {
      console.log(kleur.green(`Wallet removed for ${addr} on ${network}`));
    } else {
      console.log(kleur.yellow(`No wallet found for ${addr} on ${network}`));
    }
  } catch (error) {
    console.error(kleur.red('Failed to remove wallet'), error);
  }
}

export async function walletRegister(
  brokerId: string | undefined,
  address: string | undefined,
  network: Network
): Promise<void> {
  console.log(kleur.cyan(`\n📝 Register Account (${network})\n`));

  // Check for non-interactive mode
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (!brokerId || !address) {
      console.log(
        kleur.red('Error: --broker-id and --address are required in non-interactive mode.')
      );
      console.log(
        kleur.dim('Example: orderly wallet-register --broker-id demo --address 0x1234...')
      );
      return;
    }
  }

  let bId = brokerId;
  if (!bId) {
    const response = await prompts({
      type: 'text',
      name: 'brokerId',
      message: 'Enter your Broker ID',
      validate: (value: string) => (value.length > 0 ? true : 'Broker ID is required'),
    });
    if (!response.brokerId) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    bId = response.brokerId.trim();
  }

  let addr = address;
  let walletKey: WalletKeyPair | null = null;

  if (!addr) {
    const wallets = await listWalletKeys();
    const filteredWallets = wallets.filter((w) => w.network === network);

    if (filteredWallets.length === 0) {
      console.log(kleur.red(`No wallets found for ${network}. Import a wallet first.`));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'address',
      message: 'Select wallet to register',
      choices: filteredWallets.map((w) => ({
        title: `${w.address} (${w.walletType})`,
        value: w.address,
      })),
    });

    if (!response.address) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    addr = response.address;
  }

  if (!addr) {
    console.log(kleur.red('No address selected.'));
    return;
  }

  walletKey = await getWalletKey(addr, network);
  if (!walletKey) {
    console.log(kleur.red(`No wallet found for ${addr} on ${network}`));
    return;
  }

  if (!bId) {
    console.log(kleur.red('Broker ID is required.'));
    return;
  }

  const client = new OrderlyClient(network);

  try {
    const existingAccount = await client.getAccount(addr, bId, walletKey.walletType);
    if (existingAccount.success && existingAccount.data?.account_id) {
      console.log(kleur.yellow(`Account already exists: ${existingAccount.data.account_id}`));
      console.log(kleur.dim('Use `orderly wallet-add-key` to add an API key to this account.'));
      return;
    }
  } catch {
    // Continue with registration
  }

  const nonceResponse = await client.getRegistrationNonce();
  if (!nonceResponse.success || !nonceResponse.data?.registration_nonce) {
    console.log(kleur.red('Failed to get registration nonce'));
    return;
  }
  const nonce = nonceResponse.data.registration_nonce;

  const timestamp = Date.now();

  let message: Record<string, unknown>;
  let signature: string;
  try {
    if (walletKey.walletType === 'EVM') {
      const chainId = network === 'mainnet' ? 42161 : 421614;
      const evmMessage: RegistrationMessage = {
        brokerId: bId,
        chainId,
        timestamp: String(timestamp),
        registrationNonce: nonce,
      };
      message = { ...evmMessage };
      const wallet = createWalletFromPrivateKey(normalizePrivateKey(walletKey.privateKey));
      signature = await signEVMRegistration(wallet, evmMessage);
    } else {
      const wallet = createSolanaWalletFromPrivateKey(walletKey.privateKey, network);
      const result = await signSolanaRegistration(wallet, {
        brokerId: bId,
        timestamp,
        registrationNonce: nonce,
        network,
      });
      message = result.message;
      signature = result.signature;
    }
  } catch (error) {
    console.error(kleur.red('Failed to sign message'), error);
    return;
  }

  try {
    const result = await client.registerAccount(message, signature, addr, walletKey.walletType);
    if (result.success && result.data?.account_id) {
      console.log();
      console.log(kleur.cyan('Account ID:'));
      console.log(kleur.white(result.data.account_id));
      console.log();
      console.log(
        kleur.dim('Next step: Use `orderly wallet-add-key` to add an API key for trading.')
      );
    } else {
      console.log(kleur.red('Failed to register account'));
      console.log(kleur.dim('Response:'), result);
    }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.log(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.log(kleur.red(error.message));
    } else {
      console.error(error);
    }
  }
}

export async function walletAddKey(
  brokerId: string | undefined,
  address: string | undefined,
  scope: string | undefined,
  network: Network
): Promise<void> {
  console.log(kleur.cyan(`\n🔐 Add Orderly API Key (${network})\n`));

  // Check for non-interactive mode
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (!brokerId || !address) {
      console.log(
        kleur.red('Error: --broker-id and --address are required in non-interactive mode.')
      );
      console.log(
        kleur.dim('Example: orderly wallet-add-key --broker-id demo --address 0x1234...')
      );
      return;
    }
  }

  let bId = brokerId;
  if (!bId) {
    const response = await prompts({
      type: 'text',
      name: 'brokerId',
      message: 'Enter your Broker ID',
      validate: (value: string) => (value.length > 0 ? true : 'Broker ID is required'),
    });
    if (!response.brokerId) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    bId = response.brokerId.trim();
  }

  let addr = address;
  let walletKey: WalletKeyPair | null = null;

  if (!addr) {
    const wallets = await listWalletKeys();
    const filteredWallets = wallets.filter((w) => w.network === network);

    if (filteredWallets.length === 0) {
      console.log(kleur.red(`No wallets found for ${network}. Import a wallet first.`));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'address',
      message: 'Select wallet to add key for',
      choices: filteredWallets.map((w) => ({
        title: `${w.address} (${w.walletType})`,
        value: w.address,
      })),
    });

    if (!response.address) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    addr = response.address;
  }

  if (!addr) {
    console.log(kleur.red('No address selected.'));
    return;
  }

  if (!bId) {
    console.log(kleur.red('Broker ID is required.'));
    return;
  }

  walletKey = await getWalletKey(addr, network);
  if (!walletKey) {
    console.log(kleur.red(`No wallet found for ${addr} on ${network}`));
    return;
  }

  const client = new OrderlyClient(network);

  const accountInfo = await client.getAccount(addr, bId, walletKey.walletType);
  if (!accountInfo.success || !accountInfo.data?.account_id) {
    console.log(kleur.red('Account not found. Run `orderly wallet-register` first.'));
    return;
  }
  const accountId = accountInfo.data.account_id;

  let keyScope = scope;
  if (!keyScope) {
    const response = await prompts({
      type: 'multiselect',
      name: 'scopes',
      message: 'Select key scopes',
      choices: [
        { title: 'read', value: 'read', selected: true },
        { title: 'trading', value: 'trading', selected: true },
        { title: 'asset', value: 'asset' },
      ],
      hint: '- Space to select. Return to submit',
    });
    if (!response.scopes || response.scopes.length === 0) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    keyScope = response.scopes.join(',');
  }

  if (!keyScope) {
    console.log(kleur.red('Key scope is required.'));
    return;
  }

  const ed25519KeyPair = generateKeyPair();

  const orderlyKey = `ed25519:${getPublicKeyBase58(ed25519KeyPair.publicKey)}`;

  const timestamp = Date.now();
  const expiration = timestamp + 365 * 24 * 60 * 60 * 1000; // 1 year
  const chainId =
    walletKey.walletType === 'SOL'
      ? getSolanaChainId(network)
      : network === 'mainnet'
        ? 42161
        : 421614;

  let message: Record<string, unknown>;
  let signature: string;
  try {
    if (walletKey.walletType === 'EVM') {
      const evmMessage: AddKeyMessage = {
        brokerId: bId,
        chainId,
        orderlyKey,
        scope: keyScope,
        timestamp,
        expiration,
      };
      message = { ...evmMessage };
      const wallet = createWalletFromPrivateKey(normalizePrivateKey(walletKey.privateKey));
      signature = await signEVMAddKey(wallet, evmMessage);
    } else {
      const wallet = createSolanaWalletFromPrivateKey(walletKey.privateKey, network);
      const result = await signSolanaAddKey(wallet, {
        brokerId: bId,
        publicKey: orderlyKey,
        scope: keyScope,
        timestamp,
        expiration,
        network,
      });
      message = result.message;
      signature = result.signature;
    }
  } catch (error) {
    console.error(kleur.red('Failed to sign message'), error);
    return;
  }

  try {
    const result = await client.addOrderlyKey(message, signature, addr);
    if (result.success && result.data?.orderly_key) {
      const keyPair = {
        accountId,
        address: addr,
        walletType: walletKey.walletType,
        publicKey: ed25519KeyPair.publicKey,
        privateKey: ed25519KeyPair.privateKey,
        network,
      };

      await storeKey(accountId, network, keyPair);
      setDefaultNetwork(network);

      console.log();
      console.log(kleur.green('✅ Setup complete!'));
      console.log(kleur.dim(`Account ID: ${accountId}`));
      console.log(kleur.dim(`Orderly Key: ${orderlyKey}`));
      console.log();
      console.log(kleur.dim('You can now use trading commands like:'));
      console.log(kleur.cyan(`  orderly account-info --account ${accountId}`));
      console.log(
        kleur.cyan(`  orderly order-place PERP_ETH_USDC BUY MARKET 0.01 --account ${accountId}`)
      );
    } else {
      console.log(kleur.red('Failed to add Orderly key'));
      console.log(kleur.dim('Response:'), result);
    }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.log(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.log(kleur.red(error.message));
    } else {
      console.error(error);
    }
  }
}
