import kleur from 'kleur';
import prompts from 'prompts';
import { publicKeyFromPrivateKey } from '../lib/crypto.js';
import { storeKey, getKey, deleteKey, listKeys } from '../lib/keychain.js';
import {
  setDefaultAccount,
  getDefaultAccount,
  setDefaultNetwork,
  getDefaultNetwork,
} from '../lib/config.js';
import { KeyPair, Network } from '../types.js';

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

  try {
    await storeKey(accId, network, keyPair);
  } catch (error) {
    console.error(kleur.red('Failed to store key'), error);
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

  const keys = await listKeys();

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
    const keys = await listKeys();
    const filteredKeys = keys.filter((k) => k.network === network);

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

  try {
    const deleted = await deleteKey(accId, network);
    if (deleted) {
      console.log(kleur.green(`Key removed for ${accId} on ${network}`));
    } else {
      console.log(kleur.yellow(`No key found for ${accId} on ${network}`));
    }
  } catch (error) {
    console.error(kleur.red('Failed to remove key'), error);
  }
}

export async function show(accountId: string | undefined, network: Network): Promise<void> {
  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    console.log(kleur.dim('Use `orderly auth-init` or specify an account ID.'));
    return;
  }

  const key = await getKey(accId, network);

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

export async function exportKey(accountId: string | undefined, network: Network): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(kleur.red('This command requires an interactive terminal.'));
    console.log(kleur.dim('Run directly in your terminal, not via scripts or AI agents.'));
    return;
  }

  console.log(kleur.cyan('\n📤 Export API Key\n'));
  console.log(kleur.yellow('⚠️  WARNING: This will display your private key on screen.'));
  console.log(kleur.yellow('   Make sure no one is watching your screen.'));
  console.log();

  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    return;
  }

  const key = await getKey(accId, network);

  if (!key) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  console.log(kleur.cyan('Account:'), kleur.white(key.accountId));
  console.log(kleur.cyan('Network:'), kleur.white(key.network));
  console.log();

  const confirm = await prompts({
    type: 'text',
    name: 'confirm',
    message: 'Type "EXPORT" to confirm you want to export your private key:',
    validate: (value: string) => (value === 'EXPORT' ? true : 'You must type EXPORT exactly'),
  });

  if (!confirm.confirm) {
    console.log(kleur.red('Cancelled.'));
    return;
  }

  console.log();
  console.log(kleur.green('✅ Key exported:'));
  console.log();
  console.log(kleur.cyan('Public Key:'));
  console.log(kleur.white(key.publicKey));
  console.log();
  console.log(kleur.cyan('Private Key:'));
  console.log(kleur.white(key.privateKey));
  console.log();
  console.log(kleur.yellow('⚠️  Store your private key securely. Never share it with anyone.'));
}
