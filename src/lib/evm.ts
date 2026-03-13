import { Wallet, TypedDataEncoder } from 'ethers';
import { EIP712Domain, RegistrationMessage, AddKeyMessage, Network } from '../types.js';

const EIP712_DOMAIN: EIP712Domain = {
  name: 'Orderly',
  version: '1',
  chainId: 42161,
  verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
};

const CHAIN_IDS: Record<Network, number> = {
  mainnet: 42161,
  testnet: 421614,
};

export function getDomain(network: Network): EIP712Domain {
  return {
    ...EIP712_DOMAIN,
    chainId: CHAIN_IDS[network],
  };
}

export interface EVMWallet {
  address: string;
  signTypedData(
    domain: EIP712Domain,
    types: Record<string, unknown>,
    value: Record<string, unknown>
  ): Promise<string>;
}

export function createWalletFromPrivateKey(privateKey: string): EVMWallet {
  const wallet = new Wallet(privateKey);
  return {
    address: wallet.address,
    signTypedData: async (domain, types, value) => {
      return wallet.signTypedData(
        domain,
        types as Record<string, Array<{ name: string; type: string }>>,
        value
      );
    },
  };
}

export function isValidEVMAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function isValidPrivateKey(key: string): boolean {
  const hex = key.startsWith('0x') ? key.slice(2) : key;
  return /^[a-fA-F0-9]{64}$/.test(hex);
}

export function normalizePrivateKey(key: string): string {
  return key.startsWith('0x') ? key : `0x${key}`;
}

const REGISTRATION_TYPES = {
  Registration: [
    { name: 'brokerId', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'timestamp', type: 'uint64' },
    { name: 'registrationNonce', type: 'uint256' },
  ],
};

const ADD_KEY_TYPES = {
  AddOrderlyKey: [
    { name: 'brokerId', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'orderlyKey', type: 'string' },
    { name: 'scope', type: 'string' },
    { name: 'timestamp', type: 'uint64' },
    { name: 'expiration', type: 'uint64' },
  ],
};

export async function signRegistration(
  wallet: EVMWallet,
  message: RegistrationMessage
): Promise<string> {
  const domain = getDomain(message.chainId === 42161 ? 'mainnet' : 'testnet');
  return wallet.signTypedData(domain, REGISTRATION_TYPES, {
    brokerId: message.brokerId,
    chainId: message.chainId,
    timestamp: message.timestamp,
    registrationNonce: message.registrationNonce,
  });
}

export async function signAddKey(wallet: EVMWallet, message: AddKeyMessage): Promise<string> {
  const domain = getDomain(message.chainId === 42161 ? 'mainnet' : 'testnet');
  return wallet.signTypedData(domain, ADD_KEY_TYPES, {
    brokerId: message.brokerId,
    chainId: message.chainId,
    orderlyKey: message.orderlyKey,
    scope: message.scope,
    timestamp: message.timestamp,
    expiration: message.expiration,
  });
}

export function getRegistrationHash(message: RegistrationMessage): string {
  const domain = getDomain(message.chainId === 42161 ? 'mainnet' : 'testnet');
  return TypedDataEncoder.hash(domain, REGISTRATION_TYPES, message);
}

export function getAddKeyHash(message: AddKeyMessage): string {
  const domain = getDomain(message.chainId === 42161 ? 'mainnet' : 'testnet');
  return TypedDataEncoder.hash(domain, ADD_KEY_TYPES, message);
}
