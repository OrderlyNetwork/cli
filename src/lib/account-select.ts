import kleur from 'kleur';
import prompts from 'prompts';
import { listKeys } from './keychain.js';
import { Network } from '../types.js';

export async function resolveAccountId(
  accountId: string | undefined,
  network: Network
): Promise<string | null> {
  if (accountId) return accountId;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(kleur.red('Error: --account is required in non-interactive mode.'));
    console.error(kleur.dim('Example: --account <account-id>'));
    console.error(kleur.dim('Run `orderly auth-list` to see available accounts.'));
    process.exit(1);
  }

  const keys = await listKeys();
  const filteredKeys = keys.filter((k) => k.network === network);

  if (filteredKeys.length === 0) {
    console.error(kleur.red(`No accounts found for ${network}.`));
    console.error(kleur.dim('Run `orderly wallet-add-key` to add an account.'));
    process.exit(1);
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
