import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { sign } from './crypto.js';
import { KeyPair, Network } from '../types.js';
import { getApiBaseUrl, getDefaultNetwork } from './config.js';

export class OrderlyClient {
  private client: AxiosInstance;
  private keyPair: KeyPair | null = null;
  private network: Network;

  constructor(network?: Network) {
    this.network = network ?? getDefaultNetwork();
    this.client = axios.create({
      baseURL: getApiBaseUrl(this.network),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  getNetwork(): Network {
    return this.network;
  }

  setKeyPair(keyPair: KeyPair): void {
    this.keyPair = keyPair;
  }

  private getSignatureHeaders(
    method: string,
    path: string,
    body?: string,
    timestamp?: number
  ): Record<string, string> {
    if (!this.keyPair) {
      throw new Error('No key pair set. Please authenticate first.');
    }

    const ts = timestamp ?? Date.now();
    const message = `${method.toUpperCase()}${path}${body ? body : ''}${ts}`;
    const signature = sign(message, this.keyPair.privateKey);

    return {
      'orderly-timestamp': ts.toString(),
      'orderly-account-id': this.keyPair.accountId,
      'orderly-key': this.keyPair.publicKey,
      'orderly-signature': signature,
    };
  }

  async request<T>(config: AxiosRequestConfig, requiresAuth = true): Promise<T> {
    const method = config.method?.toUpperCase() ?? 'GET';
    const path = config.url ?? '';
    const body = config.data ? JSON.stringify(config.data) : undefined;

    const headers: Record<string, string> = {
      ...(config.headers as Record<string, string>),
    };

    if (requiresAuth) {
      const authHeaders = this.getSignatureHeaders(method, path, body);
      Object.assign(headers, authHeaders);
    }

    const response = await this.client.request<T>({
      ...config,
      headers,
    });

    return response.data;
  }

  async get<T>(path: string, requiresAuth = true): Promise<T> {
    return this.request<T>({ method: 'GET', url: path }, requiresAuth);
  }

  async post<T>(path: string, data?: unknown, requiresAuth = true): Promise<T> {
    return this.request<T>({ method: 'POST', url: path, data }, requiresAuth);
  }

  async delete<T>(path: string, requiresAuth = true): Promise<T> {
    return this.request<T>({ method: 'DELETE', url: path }, requiresAuth);
  }

  async getAccountInfo(): Promise<unknown> {
    return this.get('/v1/client/info');
  }

  async getBalances(): Promise<unknown> {
    return this.get('/v1/client/holding');
  }

  async getOrders(symbol?: string): Promise<unknown> {
    const path = symbol ? `/v1/orders?symbol=${symbol}` : '/v1/orders';
    return this.get(path);
  }

  async placeOrder(order: {
    symbol: string;
    order_type: string;
    side: string;
    order_quantity: string;
    order_price?: string;
  }): Promise<unknown> {
    return this.post('/v1/order', order);
  }

  async cancelOrder(orderId: string): Promise<unknown> {
    return this.delete(`/v1/order/${orderId}`);
  }

  async getPositions(): Promise<unknown> {
    return this.get('/v1/positions');
  }

  async closePosition(symbol: string): Promise<unknown> {
    return this.post('/v1/positions/close', { symbol });
  }

  async getMarketPrice(symbol: string): Promise<unknown> {
    return this.get(`/v1/public/kline/${symbol}`, false);
  }

  async getOrderbook(symbol: string): Promise<unknown> {
    return this.get(`/v1/orderbook/${symbol}`, false);
  }

  async faucetUsdc(userAddress: string, brokerId: string, chainId?: string): Promise<unknown> {
    if (this.network !== 'testnet') {
      throw new Error('Faucet is only available on testnet. Use --network testnet.');
    }

    const isSolana = userAddress.length > 50;
    const faucetBaseUrl = isSolana
      ? 'https://testnet-operator-sol.orderly.org'
      : 'https://testnet-operator-evm.orderly.org';

    const body: Record<string, string> = {
      user_address: userAddress,
      broker_id: brokerId,
    };

    if (chainId && !isSolana) {
      body.chain_id = chainId;
    }

    const response = await axios.post(`${faucetBaseUrl}/v1/faucet/usdc`, body, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  }

  async getAccount(
    address: string,
    brokerId: string,
    chainType?: string
  ): Promise<{ success: boolean; data?: { account_id: string } }> {
    let path = `/v1/get_account?address=${address}&broker_id=${brokerId}`;
    if (chainType) {
      path += `&chain_type=${chainType}`;
    }
    return this.get(path, false);
  }

  async getRegistrationNonce(): Promise<{ success: boolean; data: string }> {
    return this.get('/v1/registration_nonce', false);
  }

  async registerAccount(
    message: Record<string, unknown>,
    signature: string,
    userAddress: string,
    chainType?: string
  ): Promise<{ success: boolean; data?: { account_id: string } }> {
    const body: Record<string, unknown> = {
      message,
      signature,
      userAddress,
    };
    if (chainType) {
      body.chainType = chainType;
    }
    return this.post('/v1/register_account', body, false);
  }

  async addOrderlyKey(
    message: Record<string, unknown>,
    signature: string,
    userAddress: string,
    chainType?: string
  ): Promise<{ success: boolean; data?: { orderly_key: string } }> {
    const body: Record<string, unknown> = {
      message,
      signature,
      userAddress,
    };
    if (chainType) {
      body.chainType = chainType;
    }
    return this.post('/v1/orderly_key', body, false);
  }

  async getSupportedChains(
    brokerId: string
  ): Promise<{ success: boolean; data?: { chains: Array<{ chain_id: number }> } }> {
    return this.get(`/v1/public/chain_info?broker_id=${brokerId}`, false);
  }
}
