import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from 'crypto';
import { DefaultSolanaWalletAdapter } from '@orderly.network/default-solana-adapter';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { Network } from '../types.js';

const SOLANA_CHAIN_IDS: Record<Network, number> = {
  mainnet: 900900900,
  testnet: 901901901,
};

export function getSolanaChainId(network: Network): number {
  return SOLANA_CHAIN_IDS[network];
}

export interface SolanaWallet {
  address: string;
  privateKeyBytes: Uint8Array;
}

export function createSolanaWalletFromPrivateKey(
  privateKey: string,
  _network: Network
): SolanaWallet {
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
    privateKeyBytes: keyBytes,
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

function createWalletAdapter(wallet: SolanaWallet, network: Network): DefaultSolanaWalletAdapter {
  const adapter = new DefaultSolanaWalletAdapter();
  const chainId = SOLANA_CHAIN_IDS[network];

  adapter.active({
    address: wallet.address,
    chain: {
      id: chainId,
    },
    provider: {
      signMessage: async (message: Uint8Array): Promise<Uint8Array> => {
        return ed25519.sign(message, wallet.privateKeyBytes);
      },
      signTransaction: async () => {
        throw new Error('signTransaction not supported in CLI');
      },
      sendTransaction: async () => {
        throw new Error('sendTransaction not supported in CLI');
      },
      network: network === 'mainnet' ? WalletAdapterNetwork.Mainnet : WalletAdapterNetwork.Devnet,
    },
  });

  return adapter;
}

export async function signRegistration(
  wallet: SolanaWallet,
  params: {
    brokerId: string;
    timestamp: number;
    registrationNonce: string;
    network: Network;
  }
): Promise<{ message: Record<string, unknown>; signature: string }> {
  const adapter = createWalletAdapter(wallet, params.network);

  const result = await adapter.generateRegisterAccountMessage({
    brokerId: params.brokerId,
    registrationNonce: Number(params.registrationNonce),
    timestamp: params.timestamp,
  });

  return {
    message: result.message as Record<string, unknown>,
    signature: result.signatured,
  };
}

export async function signAddKey(
  wallet: SolanaWallet,
  params: {
    brokerId: string;
    publicKey: string;
    scope: string;
    timestamp: number;
    expiration: number;
    network: Network;
  }
): Promise<{ message: Record<string, unknown>; signature: string }> {
  const adapter = createWalletAdapter(wallet, params.network);

  const expirationTimestamp = params.timestamp + 1000 * 60 * 60 * 24 * params.expiration;

  const result = await adapter.generateAddOrderlyKeyMessage({
    brokerId: params.brokerId,
    publicKey: params.publicKey,
    scope: params.scope,
    timestamp: params.timestamp,
    expiration: expirationTimestamp,
  });

  return {
    message: result.message as Record<string, unknown>,
    signature: result.signatured,
  };
}

export interface GeneratedSolanaWallet {
  address: string;
  privateKey: string;
}

export function generateSolanaWallet(): GeneratedSolanaWallet {
  const privateKey = randomBytes(32);
  const publicKey = ed25519.getPublicKey(privateKey);
  const address = bs58.encode(publicKey);
  const privateKeyBase58 = bs58.encode(privateKey);

  return {
    address,
    privateKey: privateKeyBase58,
  };
}
