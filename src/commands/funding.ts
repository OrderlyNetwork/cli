import { createAuthenticatedClient } from '../lib/account-select.js';
import { output, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

export async function fundingHistory(
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
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol.toUpperCase());
    if (startT) params.append('start_t', startT.toString());
    if (endT) params.append('end_t', endT.toString());
    params.append('page', (page ?? 1).toString());
    params.append('size', (size ?? 25).toString());

    const queryString = params.toString();
    const result = await client.get(`/v1/funding_fee/history?${queryString}`);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
