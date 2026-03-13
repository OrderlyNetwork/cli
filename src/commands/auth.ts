import kleur from 'kleur';
import ora from 'ora';
import prompts from 'prompts';
import { generateKeyPair, publicKeyFromPrivateKey } from '../lib/crypto.js';
import { storeKey, getKey, deleteKey, listKeys, hasKey } from '../lib/keychain.js';
import {
  setDefaultAccount,
  getDefaultAccount,
  setDefaultNetwork,
  getDefaultNetwork,
} from '../lib/config.js';
import { KeyPair, Network } from '../types.js';

const spinner = ora();

export async function init(network: Network): Promise<void> {
  console.log(kleur.cyan(`\n🔐 Orderly CLI - Initialize Authentication (${network})\n`));

  const generated = generateKeyPair();

  console.log(kleur.dim('Generated Ed25519 keypair:'));
  console.log(kleur.dim(`  Public Key: ${generated.publicKey}`));
  console.log();

  const response = await prompts({
    type: 'text',
    name: 'accountId',
    message: 'Enter your Orderly Account ID',
    validate: (value: string) => (value.length > 0 ? true : 'Account ID is required'),
  });

  if (!response.accountId) {
    console.log(kleur.red('Cancelled.'));
    return;
  }

  const accountId = response.accountId.trim();

  spinner.start('Checking for existing key...');
  const existing = await hasKey(accountId, network);
  if (existing) {
    spinner.warn(kleur.yellow(`Key already exists for account ${accountId} on ${network}`));
    const overwrite = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Overwrite existing key?',
      initial: false,
    });
    if (!overwrite.value) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
  }
  spinner.stop();

  const keyPair: KeyPair = {
    accountId,
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    network,
  };

  spinner.start('Storing key in OS keychain...');
  try {
    await storeKey(accountId, network, keyPair);
    spinner.succeed(kleur.green('Key stored securely in OS keychain'));
  } catch (error) {
    spinner.fail(kleur.red('Failed to store key'));
    console.error(error);
    return;
  }

  setDefaultAccount(accountId);
  setDefaultNetwork(network);
  console.log(kleur.dim(`Set ${accountId} as default account for ${network}`));

  console.log();
  console.log(kleur.green('✅ Initialization complete!'));
  console.log();
  console.log(kleur.cyan('Next steps:'));
  console.log(kleur.dim('  1. Register this public key with your Orderly account'));
  console.log(kleur.dim('  2. Use `orderly account-info` to verify authentication'));
  console.log();
  console.log(kleur.yellow('Your public key (for registration):'));
  console.log(kleur.white(keyPair.publicKey));
}

export async function importKey(
  privateKey: string | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  console.log(kleur.cyan(`\n🔑 Import Existing Key (${network})\n`));

  let key: string = privateKey ?? '';
  let accId: string = accountId ?? '';

  if (!key) {
    const response = await prompts({
      type: 'password',
      name: 'privateKey',
      message: 'Enter your Ed25519 private key (base64)',
      validate: (value: string) => (value.length > 0 ? true : 'Private key is required'),
    });
    if (!response.privateKey) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    key = response.privateKey.trim();
  }

  if (!accId) {
    const response = await prompts({
      type: 'text',
      name: 'accountId',
      message: 'Enter your Orderly Account ID',
      validate: (value: string) => (value.length > 0 ? true : 'Account ID is required'),
    });
    if (!response.accountId) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    accId = response.accountId.trim();
  }

  const publicKey = publicKeyFromPrivateKey(key);
  const keyPair: KeyPair = {
    accountId: accId,
    publicKey,
    privateKey: key,
    network,
  };

  spinner.start('Storing key in OS keychain...');
  try {
    await storeKey(accId, network, keyPair);
    spinner.succeed(kleur.green('Key imported and stored securely'));
  } catch (error) {
    spinner.fail(kleur.red('Failed to store key'));
    console.error(error);
    return;
  }

  setDefaultAccount(accId);
  setDefaultNetwork(network);
  console.log();
  console.log(kleur.green('✅ Key imported successfully!'));
  console.log(kleur.dim(`Public key: ${publicKey}`));
}

export async function list(network: Network | undefined): Promise<void> {
  console.log(kleur.cyan('\n📋 Stored Keys\n'));

  spinner.start('Loading keys from keychain...');
  const keys = await listKeys();
  spinner.stop();

  const filteredKeys = network ? keys.filter((k) => k.network === network) : keys;

  if (filteredKeys.length === 0) {
    console.log(kleur.yellow('No keys stored. Run `orderly auth-init` to get started.'));
    return;
  }

  const defaultAccountId = getDefaultAccount();
  const defaultNetwork = getDefaultNetwork();

  for (const key of filteredKeys) {
    const isDefault = key.accountId === defaultAccountId && key.network === defaultNetwork;
    const prefix = isDefault ? kleur.green('✓ (default)') : ' ';
    console.log(`${prefix} ${kleur.cyan(key.accountId)} ${kleur.dim(`[${key.network}]`)}`);
    console.log(kleur.dim(`    Public Key: ${key.publicKey}`));
  }
}

export async function logout(accountId: string | undefined, network: Network): Promise<void> {
  console.log(kleur.cyan('\n🚪 Logout\n'));

  let accId = accountId;

  if (!accId) {
    spinner.start('Loading keys...');
    const keys = await listKeys();
    const filteredKeys = keys.filter((k) => k.network === network);
    spinner.stop();

    if (filteredKeys.length === 0) {
      console.log(kleur.yellow(`No keys stored for ${network}.`));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'accountId',
      message: 'Select account to logout',
      choices: filteredKeys.map((k) => ({
        title: `${k.accountId} [${k.network}]`,
        value: k.accountId,
      })),
    });

    if (!response.accountId) {
      console.log(kleur.red('Cancelled.'));
      return;
    }
    accId = response.accountId;
  }

  if (!accId) {
    console.log(kleur.red('No account selected.'));
    return;
  }

  const confirm = await prompts({
    type: 'confirm',
    name: 'value',
    message: `Remove key for account ${accId} on ${network}?`,
    initial: false,
  });

  if (!confirm.value) {
    console.log(kleur.red('Cancelled.'));
    return;
  }

  spinner.start('Removing key from keychain...');
  try {
    const deleted = await deleteKey(accId, network);
    if (deleted) {
      spinner.succeed(kleur.green(`Key removed for ${accId} on ${network}`));
    } else {
      spinner.warn(kleur.yellow(`No key found for ${accId} on ${network}`));
    }
  } catch (error) {
    spinner.fail(kleur.red('Failed to remove key'));
    console.error(error);
  }
}

export async function show(accountId: string | undefined, network: Network): Promise<void> {
  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    console.log(kleur.dim('Use `orderly auth-init` or specify an account ID.'));
    return;
  }

  spinner.start('Loading key...');
  const key = await getKey(accId, network);
  spinner.stop();

  if (!key) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  console.log(kleur.cyan('\n🔑 Account Key\n'));
  console.log(`Account ID: ${kleur.white(key.accountId)}`);
  console.log(`Network:    ${kleur.white(key.network)}`);
  console.log(`Public Key: ${kleur.white(key.publicKey)}`);
  console.log(kleur.dim('\n(Private key is stored securely and cannot be displayed)'));
}
