import * as keytar from 'keytar';
import { StoredKey, KeyPair, Network } from '../types.js';

const SERVICE_NAME = 'orderly-cli';

function makeKey(accountId: string, network: Network): string {
  return `${accountId}:${network}`;
}

export async function storeKey(
  accountId: string,
  network: Network,
  keyPair: KeyPair
): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, makeKey(accountId, network), JSON.stringify(keyPair));
}

export async function getKey(accountId: string, network: Network): Promise<KeyPair | null> {
  const data = await keytar.getPassword(SERVICE_NAME, makeKey(accountId, network));
  if (!data) return null;
  return JSON.parse(data) as KeyPair;
}

export async function deleteKey(accountId: string, network: Network): Promise<boolean> {
  return keytar.deletePassword(SERVICE_NAME, makeKey(accountId, network));
}

export async function listKeys(): Promise<StoredKey[]> {
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  return credentials.map((cred) => {
    const keyPair = JSON.parse(cred.password) as KeyPair;
    return {
      accountId: keyPair.accountId,
      publicKey: keyPair.publicKey,
      network: keyPair.network,
    };
  });
}

export async function hasKey(accountId: string, network: Network): Promise<boolean> {
  const key = await getKey(accountId, network);
  return key !== null;
}
