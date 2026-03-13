import kleur from 'kleur';
import ora from 'ora';
import prompts from 'prompts';
import { WalletKeyPair, Network, WalletType } from '../types.js';
import {
  storeWalletKey,
  getWalletKey,
  deleteWalletKey,
  listWalletKeys,
  hasWalletKey,
  getKey,
  storeKey,
  deleteKey,
  listKeys,
} from '../lib/keychain.js';
import {
  createWalletFromPrivateKey,
  isValidPrivateKey,
  normalizePrivateKey,
  signRegistration as signEVMRegistration,
  signAddKey as signEVMAddKey,
} from '../lib/evm.js';
import {
  createSolanaWalletFromPrivateKey,
  signRegistration as signSolanaRegistration,
  signAddKey as signSolanaAddKey,
  getSolanaChainId,
} from '../lib/solana.js';
import { OrderlyClient } from '../lib/api.js';
import { setDefaultAccount, setDefaultNetwork } from '../lib/config.js';

const spinner = ora();

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
      const wallet = createSolanaWalletFromPrivateKey(key);
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

  spinner.start('Checking for existing wallet...');
  const existing = await hasWalletKey(addr, network);
  if (existing) {
    spinner.warn(kleur.yellow(`Wallet already exists for ${addr} on ${network}`));
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
  spinner.stop();

  const walletKeyPair: WalletKeyPair = {
    address: addr,
    privateKey: key,
    walletType: type,
    network,
  };

  spinner.start('Storing wallet in OS keychain...');
  try {
    await storeWalletKey(addr, network, walletKeyPair);
    spinner.succeed(kleur.green('Wallet stored securely in OS keychain'));
  } catch (error) {
    spinner.fail(kleur.red('Failed to store wallet'));
    console.error(error);
    return;
  }

  console.log();
  console.log(kleur.green('✅ Wallet imported successfully!'));
  console.log(kleur.dim(`Address: ${addr}`));
  console.log(kleur.dim(`Type: ${type}`));
}

export async function walletList(network: Network | undefined): Promise<void> {
  console.log(kleur.cyan('\n📋 Stored Wallets\n'));

  spinner.start('Loading wallets from keychain...');
  const wallets = await listWalletKeys();
  spinner.stop();

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
    spinner.start('Loading wallets...');
    const wallets = await listWalletKeys();
    const filteredWallets = wallets.filter((w) => w.network === network);
    spinner.stop();

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

  spinner.start('Loading wallet...');
  const wallet = await getWalletKey(addr, network);
  spinner.stop();

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
    spinner.start('Loading wallets...');
    const wallets = await listWalletKeys();
    const filteredWallets = wallets.filter((w) => w.network === network);
    spinner.stop();

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

  spinner.start('Removing wallet from keychain...');
  try {
    const deleted = await deleteWalletKey(addr, network);
    if (deleted) {
      spinner.succeed(kleur.green(`Wallet removed for ${addr} on ${network}`));
    } else {
      spinner.warn(kleur.yellow(`No wallet found for ${addr} on ${network}`));
    }
  } catch (error) {
    spinner.fail(kleur.red('Failed to remove wallet'));
    console.error(error);
  }
}

export async function walletRegister(
  brokerId: string | undefined,
  address: string | undefined,
  network: Network
): Promise<void> {
  console.log(kleur.cyan(`\n📝 Register Account (${network})\n`));

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
    spinner.start('Loading wallets...');
    const wallets = await listWalletKeys();
    const filteredWallets = wallets.filter((w) => w.network === network);
    spinner.stop();

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

  spinner.start('Checking if account already exists...');
  try {
    const existingAccount = await client.getAccount(addr, bId, walletKey.walletType);
    if (existingAccount.success && existingAccount.data?.account_id) {
      spinner.succeed(kleur.yellow(`Account already exists: ${existingAccount.data.account_id}`));
      console.log(kleur.dim('Use `orderly wallet-add-key` to add an API key to this account.'));
      return;
    }
  } catch {
    // Continue with registration
  }
  spinner.stop();

  spinner.start('Fetching registration nonce...');
  const nonceResponse = await client.getRegistrationNonce();
  if (!nonceResponse.success) {
    spinner.fail(kleur.red('Failed to get registration nonce'));
    return;
  }
  const nonce = nonceResponse.data;
  spinner.succeed(kleur.green('Got registration nonce'));

  const timestamp = Date.now();
  const chainId =
    walletKey.walletType === 'SOL'
      ? getSolanaChainId(network)
      : network === 'mainnet'
        ? 42161
        : 421614;

  const message = {
    brokerId: bId,
    chainId,
    timestamp,
    registrationNonce: nonce,
    chainType: walletKey.walletType,
  };

  spinner.start('Signing registration message...');
  let signature: string;
  try {
    if (walletKey.walletType === 'EVM') {
      const wallet = createWalletFromPrivateKey(normalizePrivateKey(walletKey.privateKey));
      signature = await signEVMRegistration(wallet, message);
    } else {
      const wallet = createSolanaWalletFromPrivateKey(walletKey.privateKey);
      signature = await signSolanaRegistration(wallet, message);
    }
    spinner.succeed(kleur.green('Message signed'));
  } catch (error) {
    spinner.fail(kleur.red('Failed to sign message'));
    console.error(error);
    return;
  }

  spinner.start('Registering account...');
  try {
    const result = await client.registerAccount(message, signature, addr, walletKey.walletType);
    if (result.success && result.data?.account_id) {
      spinner.succeed(kleur.green('Account registered successfully!'));
      console.log();
      console.log(kleur.cyan('Account ID:'));
      console.log(kleur.white(result.data.account_id));
      console.log();
      console.log(
        kleur.dim('Next step: Use `orderly wallet-add-key` to add an API key for trading.')
      );
    } else {
      spinner.fail(kleur.red('Failed to register account'));
    }
  } catch (error) {
    spinner.fail(kleur.red('Failed to register account'));
    console.error(error);
  }
}

export async function walletAddKey(
  brokerId: string | undefined,
  address: string | undefined,
  scope: string | undefined,
  network: Network
): Promise<void> {
  console.log(kleur.cyan(`\n🔐 Add Orderly API Key (${network})\n`));

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
    spinner.start('Loading wallets...');
    const wallets = await listWalletKeys();
    const filteredWallets = wallets.filter((w) => w.network === network);
    spinner.stop();

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

  spinner.start('Checking account...');
  const accountInfo = await client.getAccount(addr, bId, walletKey.walletType);
  if (!accountInfo.success || !accountInfo.data?.account_id) {
    spinner.fail(kleur.red('Account not found. Run `orderly wallet-register` first.'));
    return;
  }
  const accountId = accountInfo.data.account_id;
  spinner.succeed(kleur.green(`Found account: ${accountId}`));

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

  // Select existing Ed25519 key to authorize
  spinner.start('Loading available Ed25519 keys...');
  const allKeys = await listKeys();
  const availableKeys = allKeys.filter((k) => k.network === network);
  spinner.stop();

  if (availableKeys.length === 0) {
    console.log(kleur.red('\nNo Ed25519 keys found. Generate one first:'));
    console.log(kleur.cyan('  orderly auth-init'));
    console.log(kleur.dim('or import an existing key:'));
    console.log(kleur.cyan('  orderly auth-import <private-key> --account <account-id>'));
    return;
  }

  const keyResponse = await prompts({
    type: 'select',
    name: 'publicKey',
    message: 'Select Ed25519 key to authorize for trading',
    choices: availableKeys.map((k) => ({
      title: `${k.publicKey.substring(0, 30)}... (${k.accountId})`,
      value: k.publicKey,
    })),
  });

  if (!keyResponse.publicKey) {
    console.log(kleur.red('Cancelled.'));
    return;
  }

  const selectedKey = availableKeys.find((k) => k.publicKey === keyResponse.publicKey);
  if (!selectedKey) {
    console.log(kleur.red('Key not found.'));
    return;
  }

  const fullKeyPair = await getKey(selectedKey.accountId, network);
  if (!fullKeyPair) {
    console.log(kleur.red('Failed to load key pair.'));
    return;
  }

  const orderlyKey = `ed25519:${fullKeyPair.publicKey}`;

  const timestamp = Date.now();
  const expiration = timestamp + 365 * 24 * 60 * 60 * 1000; // 1 year
  const chainId =
    walletKey.walletType === 'SOL'
      ? getSolanaChainId(network)
      : network === 'mainnet'
        ? 42161
        : 421614;

  const message = {
    brokerId: bId,
    chainId,
    orderlyKey,
    scope: keyScope,
    timestamp,
    expiration,
    chainType: walletKey.walletType,
  };

  spinner.start('Signing add key message...');
  let signature: string;
  try {
    if (walletKey.walletType === 'EVM') {
      const wallet = createWalletFromPrivateKey(normalizePrivateKey(walletKey.privateKey));
      signature = await signEVMAddKey(wallet, message);
    } else {
      const wallet = createSolanaWalletFromPrivateKey(walletKey.privateKey);
      signature = await signSolanaAddKey(wallet, message);
    }
    spinner.succeed(kleur.green('Message signed'));
  } catch (error) {
    spinner.fail(kleur.red('Failed to sign message'));
    console.error(error);
    return;
  }

  spinner.start('Adding Orderly key...');
  try {
    const result = await client.addOrderlyKey(message, signature, addr, walletKey.walletType);
    if (result.success && result.data?.orderly_key) {
      spinner.succeed(kleur.green('Orderly key added successfully!'));

      spinner.start('Updating key with account association...');

      // Update the key pair with the correct account ID
      const keyPair = {
        accountId,
        publicKey: fullKeyPair.publicKey,
        privateKey: fullKeyPair.privateKey,
        network,
      };

      // Remove old key if exists under different account
      const existingKey = await getKey(accountId, network);
      if (existingKey) {
        await deleteKey(accountId, network);
      }

      await storeKey(accountId, network, keyPair);
      spinner.succeed(kleur.green('API key associated with account'));

      setDefaultAccount(accountId);
      setDefaultNetwork(network);

      console.log();
      console.log(kleur.green('✅ Setup complete!'));
      console.log(kleur.dim(`Account ID: ${accountId}`));
      console.log(kleur.dim(`Orderly Key: ${orderlyKey}`));
      console.log();
      console.log(kleur.dim('You can now use trading commands like:'));
      console.log(kleur.cyan(`  orderly account-info`));
      console.log(kleur.cyan(`  orderly order-place PERP_ETH_USDC BUY MARKET 0.01`));
    } else {
      spinner.fail(kleur.red('Failed to add Orderly key'));
    }
  } catch (error) {
    spinner.fail(kleur.red('Failed to add Orderly key'));
    console.error(error);
  }
}
