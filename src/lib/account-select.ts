import prompts from 'prompts';
import { listKeys } from './keychain.js';
import { error } from './output.js';
import { Network } from '../types.js';

export async function resolveAccountId(
  accountId: string | undefined,
  network: Network
): Promise<string | null> {
  if (accountId) return accountId;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    error('--account is required in non-interactive mode.', [
      'Example: --account <account-id>',
      'Run `orderly auth-list` to see available accounts.',
    ]);
  }

  const keys = await listKeys();
  const filteredKeys = keys.filter((k) => k.network === network);

  if (filteredKeys.length === 0) {
    error(`No accounts found for ${network}.`, ['Run `orderly wallet-add-key` to add an account.']);
  }

  if (filteredKeys.length === 1) {
    return filteredKeys[0].accountId;
  }

  const response = await prompts({
    type: 'select',
    name: 'accountId',
    message: 'Select account',
    choices: filteredKeys.map((k) => ({ title: k.accountId, value: k.accountId })),
  });

  return response.accountId ?? null;
}
