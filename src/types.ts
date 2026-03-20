export type Network = 'mainnet' | 'testnet';
export type WalletType = 'EVM' | 'SOL';

export interface KeyPair {
  accountId: string;
  address: string;
  walletType?: WalletType;
  publicKey: string;
  privateKey: string;
  network: Network;
}

export interface StoredKey {
  accountId: string;
  address?: string;
  walletType?: WalletType;
  publicKey: string;
  network: Network;
}

export interface WalletKeyPair {
  address: string;
  privateKey: string;
  walletType: WalletType;
  network: Network;
}

export interface StoredWalletKey {
  address: string;
  walletType: WalletType;
  network: Network;
}

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export interface RegistrationMessage {
  brokerId: string;
  chainId: number;
  timestamp: string;
  registrationNonce: string;
  chainType?: WalletType;
}

export interface AddKeyMessage {
  brokerId: string;
  chainId: number;
  orderlyKey: string;
  scope: string;
  timestamp: number;
  expiration: number;
  chainType?: WalletType;
}

export interface OrderlyConfig {
  defaultNetwork?: Network;
}

export interface AccountInfo {
  accountId: string;
  address: string;
  chain: string;
  state: string;
  totalCollateral: number;
  totalFreeCollateral: number;
}

export interface OrderRequest {
  symbol: string;
  orderType: 'LIMIT' | 'MARKET';
  side: 'BUY' | 'SELL';
  orderQuantity: number;
  orderPrice?: number;
}

export interface Order {
  orderId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'LIMIT' | 'MARKET';
  status: string;
  orderQuantity: string;
  orderPrice?: string;
  createdTime: number;
}

export interface Position {
  symbol: string;
  side: 'BUY' | 'SELL';
  positionQty: string;
  averageEntryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  unrealizedPnlRatio: string;
}

export interface ApiConfig {
  baseUrl: string;
}

export const ORDERLY_APP_ID = 'OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY';

export const NETWORK_URLS: Record<Network, { api: string; ws: string }> = {
  mainnet: {
    api: 'https://api.orderly.org',
    ws: `wss://ws-evm.orderly.org/ws/stream/${ORDERLY_APP_ID}`,
  },
  testnet: {
    api: 'https://testnet-api.orderly.org',
    ws: `wss://testnet-ws-evm.orderly.org/ws/stream/${ORDERLY_APP_ID}`,
  },
};

export const DEFAULT_CONFIG: OrderlyConfig = {
  defaultNetwork: 'testnet',
};
