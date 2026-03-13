export interface KeyPair {
  accountId: string;
  publicKey: string;
  privateKey: string;
}

export interface StoredKey {
  accountId: string;
  publicKey: string;
}

export interface OrderlyConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  defaultAccountId?: string;
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

export const DEFAULT_CONFIG: OrderlyConfig = {
  apiBaseUrl: 'https://api.orderly.org',
  wsBaseUrl: 'wss://ws-api.orderly.org',
};
