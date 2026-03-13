import kleur from 'kleur';
import ora from 'ora';
import { OrderlyClient } from '../lib/api.js';
import { getKey } from '../lib/keychain.js';
import { getDefaultAccount } from '../lib/config.js';
import { Network } from '../types.js';

const spinner = ora();

export async function listPositions(
  accountId: string | undefined,
  network: Network
): Promise<void> {
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

  spinner.start('Fetching positions...');
  try {
    const result = await client.getPositions();
    spinner.succeed(kleur.green('Positions retrieved'));
    console.log();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    spinner.fail(kleur.red('Failed to fetch positions'));
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}

export async function closePosition(
  symbol: string,
  accountId: string | undefined,
  network: Network
): Promise<void> {
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

  spinner.start(`Closing position for ${symbol}...`);
  try {
    const result = await client.closePosition(symbol.toUpperCase());
    spinner.succeed(kleur.green('Position closed successfully'));
    console.log();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    spinner.fail(kleur.red('Failed to close position'));
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}
