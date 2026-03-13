import kleur from 'kleur';
import ora from 'ora';
import { OrderlyClient } from '../lib/api.js';
import { getKey } from '../lib/keychain.js';
import { getDefaultAccount } from '../lib/config.js';
import { Network } from '../types.js';

const spinner = ora();

export async function info(accountId: string | undefined, network: Network): Promise<void> {
  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    console.log(kleur.dim('Use `orderly auth-init` first.'));
    return;
  }

  spinner.start('Loading key...');
  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    spinner.fail(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }
  spinner.succeed('Key loaded');

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  spinner.start('Fetching account info...');
  try {
    const data = await client.getAccountInfo();
    spinner.succeed(kleur.green('Account info retrieved'));
    console.log();
    console.log(kleur.cyan('Account Info:'));
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    spinner.fail(kleur.red('Failed to fetch account info'));
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}

export async function balance(accountId: string | undefined, network: Network): Promise<void> {
  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    console.log(kleur.dim('Use `orderly auth-init` first.'));
    return;
  }

  spinner.start('Loading key...');
  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    spinner.fail(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }
  spinner.succeed('Key loaded');

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  spinner.start('Fetching balances...');
  try {
    const data = await client.getBalances();
    spinner.succeed(kleur.green('Balances retrieved'));
    console.log();
    console.log(kleur.cyan('Balances:'));
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    spinner.fail(kleur.red('Failed to fetch balances'));
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}
