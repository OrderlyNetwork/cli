import kleur from 'kleur';
import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey } from '../lib/keychain.js';
import { Network } from '../types.js';

const VALID_KLINE_TYPES = ['1m', '5m', '15m', '30m', '1h', '4h', '12h', '1d', '1w', '1mon', '1y'];

export async function getPrice(symbol: string, network: Network): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getMarketPrice(symbol.toUpperCase());
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}

export async function getKline(
  symbol: string,
  type: string,
  limit: number | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  const validType = type.toLowerCase();
  if (!VALID_KLINE_TYPES.includes(validType)) {
    console.log(kleur.red(`Invalid kline type. Use one of: ${VALID_KLINE_TYPES.join(', ')}`));
    return;
  }

  try {
    const client = new OrderlyClient(network);
    client.setKeyPair(keyPair);
    const result = await client.getKline(symbol.toUpperCase(), validType, limit);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}

export async function getOrderbook(
  symbol: string,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  try {
    const client = new OrderlyClient(network);
    client.setKeyPair(keyPair);
    const result = await client.getOrderbook(symbol.toUpperCase());
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}

export async function getSymbols(showInfo: boolean, network: Network): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = showInfo ? await client.getSymbols() : await client.getFutures();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}

export async function getMarketTrades(
  symbol: string,
  limit: number | undefined,
  network: Network
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getMarketTrades(symbol.toUpperCase(), limit);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}
