import { OrderlyClient } from '../lib/api.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

export async function faucetUsdc(
  address: string,
  brokerId: string,
  chainId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  if (network !== 'testnet') {
    error('Faucet is only available on testnet. Use --network testnet');
  }

  try {
    const client = new OrderlyClient(network);
    const result = await client.faucetUsdc(address, brokerId, chainId);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
