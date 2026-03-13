import kleur from 'kleur';
import ora from 'ora';
import { OrderlyClient } from '../lib/api.js';
import { Network } from '../types.js';

const spinner = ora();

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

  const isSolana = address.length > 50;
  const chainLabel = isSolana ? 'Solana' : chainId ? `chain ${chainId}` : 'EVM';

  spinner.start(`Requesting test USDC for ${address} (${chainLabel})...`);

  try {
    const client = new OrderlyClient(network);
    const result = await client.faucetUsdc(address, brokerId, chainId);
    spinner.succeed(kleur.green('Faucet request successful!'));
    console.log();
    console.log(kleur.cyan('Response:'));
    console.log(JSON.stringify(result, null, 2));
    console.log();
    console.log(
      kleur.dim('Note: USDC will be deposited to your Orderly account balance after a short delay.')
    );
  } catch (error) {
    spinner.fail(kleur.red('Failed to request faucet'));
    if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}
