import kleur from 'kleur';
import axios from 'axios';
import { OrderlyClient } from '../lib/api.js';
import { getKey } from '../lib/keychain.js';
import { getDefaultAccount } from '../lib/config.js';
import { Network } from '../types.js';

export async function info(accountId: string | undefined, network: Network): Promise<void> {
  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    console.log(kleur.dim('Use `orderly auth-init` first.'));
    return;
  }

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const data = await client.getAccountInfo();
    console.log(JSON.stringify(data, null, 2));
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

export async function balance(accountId: string | undefined, network: Network): Promise<void> {
  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    console.log(kleur.dim('Use `orderly auth-init` first.'));
    return;
  }

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const data = await client.getBalances();
    console.log(JSON.stringify(data, null, 2));
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
