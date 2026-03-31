import { createAuthenticatedClient } from '../lib/account-select.js';
import { output, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

export async function distributionHistory(
  status: string | undefined,
  type: string | undefined,
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
    const data = await client.getDistributionHistory(status, type, startT, endT, page, size);
    output(data, format);
  } catch (err) {
    handleError(err);
  }
}

export async function volumeStats(
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const data = await client.getVolumeStats();
    output(data, format);
  } catch (err) {
    handleError(err);
  }
}
