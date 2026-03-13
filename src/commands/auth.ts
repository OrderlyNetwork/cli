import kleur from 'kleur';
import ora from 'ora';
import prompts from 'prompts';
import { generateKeyPair, publicKeyFromPrivateKey } from '../lib/crypto.js';
import { storeKey, getKey, deleteKey, listKeys, hasKey } from '../lib/keychain.js';
import { setDefaultAccount, getDefaultAccount } from '../lib/config.js';
import { KeyPair } from '../types.js';

const spinner = ora();

export async function init(): Promise<void> {
  console.log(kleur.cyan('\n🔐 Orderly CLI - Initialize Authentication\n'));

  const keyPair = generateKeyPair();

  console.log(kleur.dim('Generated Ed25519 keypair:'));
  console.log(kleur.dim(`  Public Key: ${keyPair.publicKey}`));
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
  const existing = await hasKey(accountId);
  if (existing) {
    spinner.warn(kleur.yellow(`Key already exists for account ${accountId}`));
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

  keyPair.accountId = accountId;

  spinner.start('Storing key in OS keychain...');
  try {
    await storeKey(accountId, keyPair);
    spinner.succeed(kleur.green('Key stored securely in OS keychain'));
  } catch (error) {
    spinner.fail(kleur.red('Failed to store key'));
    console.error(error);
    return;
  }

  setDefaultAccount(accountId);
  console.log(kleur.dim(`Set ${accountId} as default account`));

  console.log();
  console.log(kleur.green('✅ Initialization complete!'));
  console.log();
  console.log(kleur.cyan('Next steps:'));
  console.log(kleur.dim('  1. Register this public key with your Orderly account'));
  console.log(kleur.dim('  2. Use `orderly account info` to verify authentication'));
  console.log();
  console.log(kleur.yellow('Your public key (for registration):'));
  console.log(kleur.white(keyPair.publicKey));
}

export async function importKey(privateKey?: string, accountId?: string): Promise<void> {
  console.log(kleur.cyan('\n🔑 Import Existing Key\n'));

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
  };

  spinner.start('Storing key in OS keychain...');
  try {
    await storeKey(accId, keyPair);
    spinner.succeed(kleur.green('Key imported and stored securely'));
  } catch (error) {
    spinner.fail(kleur.red('Failed to store key'));
    console.error(error);
    return;
  }

  setDefaultAccount(accId);
  console.log();
  console.log(kleur.green('✅ Key imported successfully!'));
  console.log(kleur.dim(`Public key: ${publicKey}`));
}

export async function list(): Promise<void> {
  console.log(kleur.cyan('\n📋 Stored Keys\n'));

  spinner.start('Loading keys from keychain...');
  const keys = await listKeys();
  spinner.stop();

  if (keys.length === 0) {
    console.log(kleur.yellow('No keys stored. Run `orderly auth init` to get started.'));
    return;
  }

  const defaultAccountId = getDefaultAccount();

  for (const key of keys) {
    const isDefault = key.accountId === defaultAccountId;
    const prefix = isDefault ? kleur.green('✓ (default)') : ' ';
    console.log(`${prefix} ${kleur.cyan(key.accountId)}`);
    console.log(kleur.dim(`    Public Key: ${key.publicKey}`));
  }
}

export async function logout(accountId?: string): Promise<void> {
  console.log(kleur.cyan('\n🚪 Logout\n'));

  let accId = accountId;

  if (!accId) {
    spinner.start('Loading keys...');
    const keys = await listKeys();
    spinner.stop();

    if (keys.length === 0) {
      console.log(kleur.yellow('No keys stored.'));
      return;
    }

    const response = await prompts({
      type: 'select',
      name: 'accountId',
      message: 'Select account to logout',
      choices: keys.map((k) => ({ title: k.accountId, value: k.accountId })),
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
    message: `Remove key for account ${accId}?`,
    initial: false,
  });

  if (!confirm.value) {
    console.log(kleur.red('Cancelled.'));
    return;
  }

  if (!accId) {
    console.log(kleur.red('No account selected.'));
    return;
  }

  spinner.start('Removing key from keychain...');
  try {
    const deleted = await deleteKey(accId);
    if (deleted) {
      spinner.succeed(kleur.green(`Key removed for ${accId}`));
    } else {
      spinner.warn(kleur.yellow(`No key found for ${accId}`));
    }
  } catch (error) {
    spinner.fail(kleur.red('Failed to remove key'));
    console.error(error);
  }
}

export async function show(accountId?: string): Promise<void> {
  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    console.log(kleur.dim('Use `orderly auth init` or specify an account ID.'));
    return;
  }

  spinner.start('Loading key...');
  const key = await getKey(accId);
  spinner.stop();

  if (!key) {
    console.log(kleur.red(`No key found for account ${accId}`));
    return;
  }

  console.log(kleur.cyan('\n🔑 Account Key\n'));
  console.log(`Account ID: ${kleur.white(key.accountId)}`);
  console.log(`Public Key:  ${kleur.white(key.publicKey)}`);
  console.log(kleur.dim('\n(Private key is stored securely and cannot be displayed)'));
}
