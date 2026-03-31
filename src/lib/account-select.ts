import prompts from 'prompts';
import { listKeys, getKey } from './keychain.js';
import { error } from './output.js';
import { OrderlyClient } from './api.js';
import { KeyPair, Network } from '../types.js';

export async function resolveAccountId(
  accountId: string | undefined,
  network: Network
): Promise<string | null> {
  if (accountId) return accountId;

  const keys = await listKeys();
  const filteredKeys = keys.filter((k) => k.network === network);

  if (filteredKeys.length === 0) {
    error(`No accounts found for ${network}.`, ['Run `orderly wallet-add-key` to add an account.']);
  }

  if (filteredKeys.length === 1) {
    return filteredKeys[0].accountId;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    error('Multiple accounts found. Specify --account in non-interactive mode.', [
      'Available accounts:',
      ...filteredKeys.map((k) => `  ${k.accountId} (${k.walletType})`),
      'Run `orderly auth-list` to see all accounts.',
    ]);
  }

  const response = await prompts({
    type: 'select',
    name: 'accountId',
    message: 'Select account',
    choices: filteredKeys.map((k) => ({
      title: `${k.accountId} (${k.walletType})`,
      value: k.accountId,
    })),
  });

  return response.accountId ?? null;
}

export async function resolveKeyPair(
  accountId: string | undefined,
  network: Network
): Promise<{ accId: string; keyPair: KeyPair }> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) {
    error('No account resolved.');
  }

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  return { accId, keyPair };
}

export async function createAuthenticatedClient(
  accountId: string | undefined,
  network: Network
): Promise<{ accId: string; keyPair: KeyPair; client: OrderlyClient }> {
  const { accId, keyPair } = await resolveKeyPair(accountId, network);

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  return { accId, keyPair, client };
}
