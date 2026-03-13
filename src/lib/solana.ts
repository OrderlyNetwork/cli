import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import { RegistrationMessage, AddKeyMessage, Network } from '../types.js';

const SOLANA_CHAIN_IDS: Record<Network, number> = {
  mainnet: 900900900,
  testnet: 901901901,
};

export function getSolanaChainId(network: Network): number {
  return SOLANA_CHAIN_IDS[network];
}

export interface SolanaWallet {
  address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export function createSolanaWalletFromPrivateKey(privateKey: string): SolanaWallet {
  let keyBytes: Uint8Array;

  if (privateKey.includes(',') || privateKey.includes('[')) {
    const nums = privateKey
      .replace(/[[\]]/g, '')
      .split(',')
      .map((n) => parseInt(n.trim(), 10));
    keyBytes = new Uint8Array(nums);
  } else {
    try {
      keyBytes = bs58.decode(privateKey);
    } catch {
      if (/^[a-fA-F0-9]+$/.test(privateKey)) {
        const hex = privateKey.length === 64 ? privateKey : privateKey.slice(0, 64);
        keyBytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          keyBytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
        }
      } else {
        throw new Error('Invalid Solana private key format');
      }
    }
  }

  if (keyBytes.length === 64) {
    keyBytes = keyBytes.slice(0, 32);
  }

  if (keyBytes.length !== 32) {
    throw new Error(`Invalid private key length: ${keyBytes.length}, expected 32 or 64 bytes`);
  }

  const publicKey = ed25519.getPublicKey(keyBytes);
  const address = bs58.encode(publicKey);

  return {
    address,
    signMessage: async (message: Uint8Array) => {
      return ed25519.sign(message, keyBytes);
    },
  };
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    const decoded = bs58.decode(address);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

function buildRegistrationMessage(message: RegistrationMessage): Uint8Array {
  const encoder = new TextEncoder();
  const parts = [
    encoder.encode(message.brokerId),
    encoder.encode(message.chainId.toString()),
    encoder.encode(message.timestamp.toString()),
    encoder.encode(message.registrationNonce),
  ];

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function buildAddKeyMessage(message: AddKeyMessage): Uint8Array {
  const encoder = new TextEncoder();
  const parts = [
    encoder.encode(message.brokerId),
    encoder.encode(message.chainId.toString()),
    encoder.encode(message.orderlyKey),
    encoder.encode(message.scope),
    encoder.encode(message.timestamp.toString()),
    encoder.encode(message.expiration.toString()),
  ];

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export async function signRegistration(
  wallet: SolanaWallet,
  message: RegistrationMessage
): Promise<string> {
  const messageBytes = buildRegistrationMessage(message);
  const signature = await wallet.signMessage(messageBytes);
  return bs58.encode(signature);
}

export async function signAddKey(wallet: SolanaWallet, message: AddKeyMessage): Promise<string> {
  const messageBytes = buildAddKeyMessage(message);
  const signature = await wallet.signMessage(messageBytes);
  return bs58.encode(signature);
}
