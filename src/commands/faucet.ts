import { OrderlyClient } from '../lib/api.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

interface FaucetResponse {
  success?: boolean;
  message?: string;
  code?: number;
  data?: unknown;
  [key: string]: unknown;
}

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
    const result = (await client.faucetUsdc(address, brokerId, chainId)) as FaucetResponse;

    if (result && result.success === false) {
      error(result.message || `Faucet request failed (code: ${result.code})`);
    }

    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
