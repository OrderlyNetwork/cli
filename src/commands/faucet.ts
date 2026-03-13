import kleur from 'kleur';
import axios from 'axios';
import { OrderlyClient } from '../lib/api.js';
import { Network } from '../types.js';

export async function faucetUsdc(
  address: string,
  brokerId: string,
  chainId: string | undefined,
  network: Network
): Promise<void> {
  if (network !== 'testnet') {
    console.log(kleur.red('Faucet is only available on testnet.'));
    console.log(kleur.dim('Use --network testnet'));
    return;
  }

  try {
    const client = new OrderlyClient(network);
    const result = await client.faucetUsdc(address, brokerId, chainId);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.error(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}
