import kleur from 'kleur';
import axios from 'axios';
import { OrderlyClient } from '../lib/api.js';
import { getKey } from '../lib/keychain.js';
import { getDefaultAccount } from '../lib/config.js';
import { Network } from '../types.js';

export async function fundingHistory(
  symbol: string | undefined,
  startT: number | undefined,
  endT: number | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    console.log(kleur.dim('Use `orderly wallet-add-key` first.'));
    return;
  }

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  console.log(kleur.cyan('\n💰 Funding Fee History\n'));

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol.toUpperCase());
    if (startT) params.append('start_t', startT.toString());
    if (endT) params.append('end_t', endT.toString());
    params.append('page', '1');
    params.append('size', '25');

    const queryString = params.toString();
    const result = await client.get(`/v1/funding_fee/history?${queryString}`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.log(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.log(kleur.red(error.message));
    }
  }
}
