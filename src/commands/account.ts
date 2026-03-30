import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey } from '../lib/keychain.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

function unwrap(data: unknown): Record<string, unknown> {
  const obj = data as Record<string, unknown>;
  if (obj && typeof obj === 'object' && 'data' in obj && obj.success) {
    return obj.data as Record<string, unknown>;
  }
  return obj;
}

export async function info(
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

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const raw = await client.getAccountInfo();
    const { imr_factor: _imr, max_notional: _max, ...core } = unwrap(raw);
    output(core, format);
  } catch (err) {
    handleError(err);
  }
}

export async function limits(
  accountId: string | undefined,
  symbol: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const raw = await client.getAccountInfo();
    const info = unwrap(raw);

    if (symbol) {
      const symbolRaw = await client.get(`/v1/public/info/${symbol}`, false);
      const symbolInfo = unwrap(symbolRaw);
      const imrMap = (info.imr_factor || {}) as Record<string, unknown>;
      const notionalMap = (info.max_notional || {}) as Record<string, unknown>;

      const result: Record<string, unknown> = {
        account_id: info.account_id,
        max_leverage: info.max_leverage,
        symbol,
        base_imr: symbolInfo.base_imr,
        base_mmr: symbolInfo.base_mmr,
        account_imr_factor: imrMap[symbol] ?? null,
        account_max_notional: notionalMap[symbol] ?? null,
        min_notional: symbolInfo.min_notional,
        price_range: symbolInfo.price_range,
        base_min: symbolInfo.base_min,
        base_max: symbolInfo.base_max,
        base_tick: symbolInfo.base_tick,
        quote_tick: symbolInfo.quote_tick,
        liquidation_tier: symbolInfo.liquidation_tier,
      };
      output(result, format);
    } else {
      const result: Record<string, unknown> = {
        account_id: info.account_id,
        max_leverage: info.max_leverage,
      };
      if (info.imr_factor !== undefined) result.imr_factor = info.imr_factor;
      if (info.max_notional !== undefined) result.max_notional = info.max_notional;
      output(result, format);
    }
  } catch (err) {
    handleError(err);
  }
}

export async function balance(
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

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const data = await client.getBalances();
    output(data, format);
  } catch (err) {
    handleError(err);
  }
}

export async function statistics(
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

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const data = await client.getStatistics();
    output(data, format);
  } catch (err) {
    handleError(err);
  }
}
