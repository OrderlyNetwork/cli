import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey } from '../lib/keychain.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
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
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

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
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const data = await client.getVolumeStats();
    output(data, format);
  } catch (err) {
    handleError(err);
  }
}
