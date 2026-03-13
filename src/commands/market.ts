import kleur from 'kleur';
import ora from 'ora';
import { OrderlyClient } from '../lib/api.js';
import { Network } from '../types.js';

const spinner = ora();

export async function getPrice(symbol: string, network: Network): Promise<void> {
  spinner.start(`Fetching price for ${symbol} on ${network}...`);
  try {
    const client = new OrderlyClient(network);
    const result = await client.getMarketPrice(symbol.toUpperCase());
    spinner.succeed(kleur.green('Price retrieved'));
    console.log();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    spinner.fail(kleur.red('Failed to fetch price'));
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}

export async function getOrderbook(symbol: string, network: Network): Promise<void> {
  spinner.start(`Fetching orderbook for ${symbol} on ${network}...`);
  try {
    const client = new OrderlyClient(network);
    const result = await client.getOrderbook(symbol.toUpperCase());
    spinner.succeed(kleur.green('Orderbook retrieved'));
    console.log();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    spinner.fail(kleur.red('Failed to fetch orderbook'));
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}
