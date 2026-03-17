import axios from 'axios';
import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey } from '../lib/keychain.js';
import { output, error, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

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
    const data = await client.getAccountInfo();
    output(data, format);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data) {
      error(`API Error: ${err.response.data.message || JSON.stringify(err.response.data)}`);
    } else if (err instanceof Error) {
      error(err.message);
    }
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
    if (axios.isAxiosError(err) && err.response?.data) {
      error(`API Error: ${err.response.data.message || JSON.stringify(err.response.data)}`);
    } else if (err instanceof Error) {
      error(err.message);
    }
  }
}
