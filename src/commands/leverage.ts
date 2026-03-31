import { createAuthenticatedClient } from '../lib/account-select.js';
import { output, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

export async function getOrSetLeverage(
  symbol: string,
  leverage: number | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

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
