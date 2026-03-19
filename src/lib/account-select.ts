import prompts from 'prompts';
import { listKeys } from './keychain.js';
import { error } from './output.js';
import { Network } from '../types.js';

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
