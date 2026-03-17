import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey } from '../lib/keychain.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
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
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

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
