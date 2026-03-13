import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from 'crypto';
import { AbiCoder, solidityPackedKeccak256, keccak256, getBytes } from 'ethers';
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
  const chainId = SOLANA_CHAIN_IDS[params.network];

  const message = {
    brokerId: params.brokerId,
    chainId,
    timestamp: params.timestamp,
    registrationNonce: params.registrationNonce,
  };

  const brokerIdHash = solidityPackedKeccak256(['string'], [message.brokerId]);

  const abicoder = AbiCoder.defaultAbiCoder();
  const encodedData = abicoder.encode(
    ['bytes32', 'uint256', 'uint256', 'uint256'],
    [brokerIdHash, message.chainId, message.timestamp, message.registrationNonce]
  );

  const msgToSign = keccak256(getBytes(encodedData));
  const msgToSignHex = msgToSign.slice(2);

  const msgToSignTextEncoded: Uint8Array = new TextEncoder().encode(msgToSignHex);

  const signatureBytes = ed25519.sign(msgToSignTextEncoded, wallet.privateKeyBytes);
  const signature = `0x${  bytesToHex(signatureBytes)}`;

  return {
    message: {
      ...message,
      chainType: 'SOL',
    },
    signature,
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
  const chainId = SOLANA_CHAIN_IDS[params.network];

  const message = {
    brokerId: params.brokerId,
    chainType: 'SOL',
    orderlyKey: params.publicKey,
    scope: params.scope,
    chainId,
    timestamp: params.timestamp,
    expiration: params.expiration,
  };

  const brokerIdHash = solidityPackedKeccak256(['string'], [message.brokerId]);
  const orderlyKeyHash = solidityPackedKeccak256(['string'], [message.orderlyKey]);
  const scopeHash = solidityPackedKeccak256(['string'], [message.scope]);

  const abicoder = AbiCoder.defaultAbiCoder();
  const encodedData = abicoder.encode(
    ['bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256', 'uint256'],
    [
      brokerIdHash,
      orderlyKeyHash,
      scopeHash,
      message.chainId,
      message.timestamp,
      message.expiration,
    ]
  );

  const msgToSign = keccak256(getBytes(encodedData));
  const msgToSignHex = msgToSign.slice(2);

  const msgToSignTextEncoded: Uint8Array = new TextEncoder().encode(msgToSignHex);

  const signatureBytes = ed25519.sign(msgToSignTextEncoded, wallet.privateKeyBytes);
  const signature = `0x${  bytesToHex(signatureBytes)}`;

  return {
    message,
    signature,
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
