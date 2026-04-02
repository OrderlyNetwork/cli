import { createAuthenticatedClient } from '../lib/account-select.js';
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
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const raw = await client.getAccountInfo();
    output(raw, format);
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
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const raw = await client.getAccountInfo();
    const info = unwrap(raw);

    if (symbol) {
      let symbolData: Record<string, unknown> | undefined;
      try {
        const symbolRaw = await client.get(`/v1/public/info/${symbol}`, false);
        const resp = symbolRaw as Record<string, unknown> | undefined;
        if (resp && typeof resp === 'object' && resp.success) {
          symbolData = resp.data as Record<string, unknown>;
        }
      } catch {
        // error handled below via symbolData check
      }

      if (!symbolData) {
        error(`Symbol ${symbol} not found.`, ['Use "orderly symbols" to list available symbols.']);
      }

      output({ account: info, symbol: { symbol, ...symbolData } }, format);
    } else {
      output(info, format);
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
  const { client } = await createAuthenticatedClient(accountId, network);

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
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const data = await client.getStatistics();
    output(data, format);
  } catch (err) {
    handleError(err);
  }
}

export async function keyInfo(
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const data = await client.getKeyInfo();
    output(data, format);
  } catch (err) {
    handleError(err);
  }
}

function extractFeeTier(info: Record<string, unknown>) {
  return {
    account_id: info.account_id,
    futures: {
      maker_fee_rate: info.futures_maker_fee_rate ?? null,
      taker_fee_rate: info.futures_taker_fee_rate ?? null,
    },
    rwa: {
      maker_fee_rate: info.rwa_maker_fee_rate ?? null,
      taker_fee_rate: info.rwa_taker_fee_rate ?? null,
    },
    default: {
      maker_fee_rate: info.maker_fee_rate ?? null,
      taker_fee_rate: info.taker_fee_rate ?? null,
    },
  };
}

export async function feeTier(
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const raw = await client.getAccountInfo();
    const info = unwrap(raw);
    output(extractFeeTier(info), format);
  } catch (err) {
    handleError(err);
  }
}

export async function liquidations(
  symbol: string | undefined,
  page: number | undefined,
  size: number | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.getLiquidations(symbol, page, size);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
