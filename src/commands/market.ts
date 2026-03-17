import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey } from '../lib/keychain.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

const VALID_KLINE_TYPES = ['1m', '5m', '15m', '30m', '1h', '4h', '12h', '1d', '1w', '1mon', '1y'];

export async function getPrice(
  symbol: string,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getMarketPrice(symbol.toUpperCase());
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

// /v1/kline requires auth (confirmed via unauthenticated curl returns orderly-account-id header is empty)
export async function getKline(
  symbol: string,
  type: string,
  limit: number | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const validType = type.toLowerCase();
  if (!VALID_KLINE_TYPES.includes(validType)) {
    error(`Invalid kline type. Use one of: ${VALID_KLINE_TYPES.join(', ')}`);
  }

  try {
    const client = new OrderlyClient(network);
    client.setKeyPair(keyPair);
    const result = await client.getKline(symbol.toUpperCase(), validType, limit);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

// /v1/orderbook requires auth (confirmed via unauthenticated curl returns orderly-account-id header is empty)
export async function getOrderbook(
  symbol: string,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  try {
    const client = new OrderlyClient(network);
    client.setKeyPair(keyPair);
    const result = await client.getOrderbook(symbol.toUpperCase());
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getSymbols(
  showInfo: boolean,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = showInfo ? await client.getSymbols() : await client.getFutures();
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getMarketTrades(
  symbol: string,
  limit: number | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getMarketTrades(symbol.toUpperCase(), limit);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getFundingRates(
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getFundingRates();
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
