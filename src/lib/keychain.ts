import * as keytar from 'keytar';
import { StoredKey, KeyPair } from '../types.js';

const SERVICE_NAME = 'orderly-cli';

export async function storeKey(accountId: string, keyPair: KeyPair): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, accountId, JSON.stringify(keyPair));
}

export async function getKey(accountId: string): Promise<KeyPair | null> {
  const data = await keytar.getPassword(SERVICE_NAME, accountId);
  if (!data) return null;
  return JSON.parse(data) as KeyPair;
}

export async function deleteKey(accountId: string): Promise<boolean> {
  return keytar.deletePassword(SERVICE_NAME, accountId);
}

export async function listKeys(): Promise<StoredKey[]> {
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  return credentials.map((cred) => {
    const keyPair = JSON.parse(cred.password) as KeyPair;
    return {
      accountId: cred.account,
      publicKey: keyPair.publicKey,
    };
  });
}

export async function hasKey(accountId: string): Promise<boolean> {
  const key = await getKey(accountId);
  return key !== null;
}
