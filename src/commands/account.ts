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

function extractFlatFields(info: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(info)) {
    if (typeof value !== 'object' || value === null) {
      flat[key] = value;
    }
  }
  return flat;
}

function limitsToRows(info: Record<string, unknown>): Record<string, unknown>[] {
  const imrFactor = info.imr_factor as Record<string, unknown> | undefined;
  const maxNotional = info.max_notional as Record<string, unknown> | undefined;
  const symbols = new Set([...Object.keys(imrFactor || {}), ...Object.keys(maxNotional || {})]);
  const rows: Record<string, unknown>[] = [];
  for (const sym of symbols) {
    rows.push({
      symbol: sym,
      max_leverage: info.max_leverage ?? '',
      imr_factor: imrFactor?.[sym] ?? '',
      max_notional: maxNotional?.[sym] ?? '',
    });
  }
  return rows;
}

export async function info(
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const raw = await client.getAccountInfo();
    if (format === 'csv') {
      output(extractFlatFields(unwrap(raw)), format);
    } else {
      output(raw, format);
    }
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
        error(`Symbol ${symbol} not found.`, ['Use "orderly symbols" to see available symbols.']);
      }

      if (format === 'csv') {
        const imrFactor = info.imr_factor as Record<string, unknown> | undefined;
        const maxNotional = info.max_notional as Record<string, unknown> | undefined;
        output(
          {
            rows: [
              {
                symbol,
                account_max_leverage: info.max_leverage ?? '',
                account_imr_factor: imrFactor?.[symbol] ?? '',
                account_max_notional: maxNotional?.[symbol] ?? '',
                ...symbolData,
              },
            ],
          },
          format
        );
      } else {
        output({ account: info, symbol: { symbol, ...symbolData } }, format);
      }
    } else if (format === 'csv') {
      output({ rows: limitsToRows(info) }, format);
    } else {
      const limits = {
        max_leverage: info.max_leverage ?? null,
        imr_factor: info.imr_factor ?? null,
        max_notional: info.max_notional ?? null,
      };
      output(limits, format);
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
