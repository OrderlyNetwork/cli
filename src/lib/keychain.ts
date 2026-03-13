import keytar from 'keytar';
import {
  StoredKey,
  KeyPair,
  Network,
  WalletKeyPair,
  StoredWalletKey,
  WalletType,
} from '../types.js';

const SERVICE_NAME = 'orderly-cli';
const SERVICE_NAME_WALLET = 'orderly-cli-wallet';

function makeKey(accountId: string, network: Network): string {
  return `${accountId}:${network}`;
}

function makeWalletKey(address: string, network: Network): string {
  return `${address}:${network}`;
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

export async function storeWalletKey(
  address: string,
  network: Network,
  walletKeyPair: WalletKeyPair
): Promise<void> {
  await keytar.setPassword(
    SERVICE_NAME_WALLET,
    makeWalletKey(address, network),
    JSON.stringify(walletKeyPair)
  );
}

export async function getWalletKey(
  address: string,
  network: Network
): Promise<WalletKeyPair | null> {
  const data = await keytar.getPassword(SERVICE_NAME_WALLET, makeWalletKey(address, network));
  if (!data) return null;
  return JSON.parse(data) as WalletKeyPair;
}

export async function deleteWalletKey(address: string, network: Network): Promise<boolean> {
  return keytar.deletePassword(SERVICE_NAME_WALLET, makeWalletKey(address, network));
}

export async function listWalletKeys(): Promise<StoredWalletKey[]> {
  const credentials = await keytar.findCredentials(SERVICE_NAME_WALLET);
  return credentials.map((cred) => {
    const walletKey = JSON.parse(cred.password) as WalletKeyPair;
    return {
      address: walletKey.address,
      walletType: walletKey.walletType,
      network: walletKey.network,
    };
  });
}

export async function hasWalletKey(address: string, network: Network): Promise<boolean> {
  const key = await getWalletKey(address, network);
  return key !== null;
}

export async function getWalletKeyByType(
  walletType: WalletType,
  network: Network
): Promise<WalletKeyPair | null> {
  const keys = await listWalletKeys();
  const match = keys.find((k) => k.walletType === walletType && k.network === network);
  if (!match) return null;
  return getWalletKey(match.address, network);
}
