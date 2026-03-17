import kleur from 'kleur';
import prompts from 'prompts';
import { publicKeyFromPrivateKey, base64ToBase58 } from '../lib/crypto.js';
import { storeKey, getKey, deleteKey, listKeys } from '../lib/keychain.js';
import { setDefaultNetwork } from '../lib/config.js';
import { resolveAccountId } from '../lib/account-select.js';
import { KeyPair, Network } from '../types.js';
import { error } from '../lib/output.js';

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
      error('Cancelled.');
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
      error('Cancelled.');
    }
    accId = response.accountId.trim();
  }

  const publicKey = publicKeyFromPrivateKey(key);
  const keyPair: KeyPair = {
    accountId: accId,
    address: '',
    publicKey,
    privateKey: key,
    network,
  };

  try {
    await storeKey(accId, network, keyPair);
  } catch (err) {
    error(`Failed to store key: ${err}`);
  }

  setDefaultNetwork(network);
  console.log();
  console.log(kleur.green('✅ Key imported successfully!'));
  console.log(kleur.dim(`Account ID: ${accId}`));
  console.log(kleur.dim(`Public key: ${publicKey}`));
}

function getWalletType(key: { accountId: string; walletType?: string }): string {
  if (key.walletType) {
    return key.walletType;
  }
  return 'Unknown';
}

export async function list(network: Network | undefined): Promise<void> {
  console.log(kleur.cyan('\n📋 Stored API Keys\n'));

  const keys = await listKeys();

  const filteredKeys = network ? keys.filter((k) => k.network === network) : keys;

  if (filteredKeys.length === 0) {
    console.log(kleur.yellow('No keys stored. Run `orderly wallet-add-key` to get started.'));
    return;
  }

  for (const key of filteredKeys) {
    const publicKeyBase58 = base64ToBase58(key.publicKey);
    const walletType = getWalletType(key);
    console.log(
      `${kleur.cyan(key.accountId)} ${kleur.dim(`[${key.network}]`)} ${kleur.yellow(`(${walletType})`)}`
    );
    if (key.address) {
      console.log(kleur.dim(`    Address:        ${key.address}`));
    }
    console.log(kleur.dim(`    API Public Key: ${publicKeyBase58}`));
  }
}

export async function logout(
  accountId: string | undefined,
  network: Network,
  force: boolean = false
): Promise<void> {
  console.log(kleur.cyan('\n🚪 Logout\n'));

  let accId = accountId;

  if (!accId) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      error('Error: --account is required in non-interactive mode.');
    }

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
      error('Cancelled.');
    }
    accId = response.accountId;
  }

  if (!accId) {
    error('No account selected.');
  }

  if (!force) {
    const confirm = await prompts({
      type: 'confirm',
      name: 'value',
      message: `Remove key for account ${accId} on ${network}?`,
      initial: false,
    });

    if (!confirm.value) {
      error('Cancelled.');
    }
  }

  try {
    const deleted = await deleteKey(accId, network);
    if (deleted) {
      console.log(kleur.green(`Key removed for ${accId} on ${network}`));
    } else {
      console.log(kleur.yellow(`No key found for ${accId} on ${network}`));
    }
  } catch (err) {
    error(`Failed to remove key: ${err}`);
  }
}

export async function show(accountId: string | undefined, network: Network): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const key = await getKey(accId, network);

  if (!key) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const publicKeyBase58 = base64ToBase58(key.publicKey);
  const walletType = getWalletType(key);

  console.log(kleur.cyan('\n🔑 API Key Details\n'));
  console.log(`Account ID:     ${kleur.white(key.accountId)}`);
  if (key.address) {
    console.log(`Address:        ${kleur.white(key.address)}`);
  }
  console.log(`Network:        ${kleur.white(key.network)}`);
  console.log(`Wallet Type:    ${kleur.white(walletType)}`);
  console.log(`API Public Key: ${kleur.white(publicKeyBase58)}`);
  console.log(kleur.dim('\n(Private key is stored securely and cannot be displayed)'));
}

export async function cleanup(network: Network): Promise<void> {
  console.log(kleur.cyan('\n🧹 Cleaning up keys\n'));

  const keys = await listKeys();
  const filteredKeys = keys.filter((k) => k.network === network);

  if (filteredKeys.length === 0) {
    console.log(kleur.green(`No keys found for ${network}.`));
    return;
  }

  console.log(kleur.yellow(`Found ${filteredKeys.length} key(s) for ${network}:`));
  for (const key of filteredKeys) {
    console.log(kleur.dim(`  - ${key.accountId}`));
  }
  console.log();

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const confirm = await prompts({
      type: 'confirm',
      name: 'value',
      message: `Delete all ${filteredKeys.length} key(s)?`,
      initial: false,
    });

    if (!confirm.value) {
      error('Cancelled.');
    }
  }

  let removed = 0;
  for (const key of filteredKeys) {
    try {
      await deleteKey(key.accountId, network);
      console.log(kleur.green(`✓ Removed: ${key.accountId}`));
      removed++;
    } catch (err) {
      console.log(kleur.red(`Failed to remove ${key.accountId}: ${err}`));
    }
  }

  console.log(kleur.green(`\n✅ Cleanup complete. ${removed} key(s) removed.`));
}

export async function exportKey(accountId: string | undefined, network: Network): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    error('This command requires an interactive terminal.');
  }
  console.log(kleur.cyan('\n📤 Export API Key\n'));
  console.log(kleur.yellow('⚠️  WARNING: This will display your private key on screen.'));
  console.log(kleur.yellow('   Make sure no one is watching your screen.'));
  console.log();

  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const key = await getKey(accId, network);

  if (!key) {
    error(`No key found for account ${accId} on ${network}`);
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
    error('Cancelled.');
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
