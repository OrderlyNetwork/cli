import { createAuthenticatedClient } from '../lib/account-select.js';
import { output, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

export async function listPositions(
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.getPositions();
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function closePosition(
  symbol: string,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json',
  quantity?: number
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.closePosition(symbol.toUpperCase(), quantity);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function positionHistory(
  symbol: string | undefined,
  startT: number | undefined,
  endT: number | undefined,
  page: number | undefined,
  size: number | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.getPositionHistory(symbol, startT, endT, page, size);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
