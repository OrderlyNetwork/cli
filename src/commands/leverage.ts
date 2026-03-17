import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey } from '../lib/keychain.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

export async function getOrSetLeverage(
  symbol: string,
  leverage: number | undefined,
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
    let result;
    if (leverage !== undefined) {
      result = await client.setLeverage(symbol.toUpperCase(), leverage);
    } else {
      result = await client.getLeverage(symbol.toUpperCase());
    }
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
