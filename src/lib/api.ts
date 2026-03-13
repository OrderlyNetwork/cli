import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { sign, getPublicKeyBase58 } from './crypto.js';
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
    const message = `${ts}${method.toUpperCase()}${path}${body ? body : ''}`;
    const signature = sign(message, this.keyPair.privateKey);

    return {
      'orderly-timestamp': ts.toString(),
      'orderly-account-id': this.keyPair.accountId,
      'orderly-key': `ed25519:${getPublicKeyBase58(this.keyPair.publicKey)}`,
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

    // Set Content-Type only for requests with body
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

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
    return this.request<T>(
      {
        method: 'DELETE',
        url: path,
        transformRequest: [
          (data, headers) => {
            delete headers['Content-Type'];
            delete headers['content-type'];
            return data;
          },
        ],
      },
      requiresAuth
    );
  }

  async put<T>(path: string, data?: unknown, requiresAuth = true): Promise<T> {
    return this.request<T>({ method: 'PUT', url: path, data }, requiresAuth);
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
    reduce_only?: boolean;
  }): Promise<unknown> {
    return this.post('/v1/order', order);
  }

  async cancelOrder(orderId: string, symbol?: string): Promise<unknown> {
    const path = symbol
      ? `/v1/order?order_id=${orderId}&symbol=${symbol}`
      : `/v1/order?order_id=${orderId}`;
    return this.delete(path);
  }

  async editOrder(
    orderId: string,
    updates: { order_price?: string; order_quantity?: string },
    symbol: string
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      order_id: orderId,
      symbol,
    };
    if (updates.order_price !== undefined) {
      body.order_price = updates.order_price;
    }
    if (updates.order_quantity !== undefined) {
      body.order_quantity = updates.order_quantity;
    }
    return this.put('/v1/order', body);
  }

  async cancelAllOrders(symbol?: string): Promise<unknown> {
    const path = symbol ? `/v1/orders?symbol=${symbol}` : '/v1/orders';
    return this.delete(path);
  }

  async getPositions(): Promise<unknown> {
    return this.get('/v1/positions');
  }

  async getPosition(symbol: string): Promise<{
    success: boolean;
    data?: {
      symbol: string;
      position_qty: number;
      average_open_price: number;
    };
  }> {
    return this.get(`/v1/position/${symbol}`);
  }

  async closePosition(symbol: string): Promise<unknown> {
    const positionResponse = await this.getPosition(symbol);
    if (!positionResponse.success || !positionResponse.data) {
      throw new Error(`No position found for ${symbol}`);
    }

    const { position_qty } = positionResponse.data;
    if (position_qty === 0) {
      throw new Error(`Position for ${symbol} is already closed`);
    }

    const side = position_qty > 0 ? 'SELL' : 'BUY';
    const quantity = Math.abs(position_qty).toString();

    return this.placeOrder({
      symbol,
      order_type: 'MARKET',
      side,
      order_quantity: quantity,
      reduce_only: true,
    });
  }

  async getMarketPrice(symbol: string): Promise<unknown> {
    return this.get(`/v1/public/futures/${symbol}`, false);
  }

  async getSymbols(): Promise<unknown> {
    return this.get('/v1/public/info', false);
  }

  async getFutures(): Promise<unknown> {
    return this.get('/v1/public/futures', false);
  }

  async getOrderbook(symbol: string): Promise<unknown> {
    return this.get(`/v1/orderbook/${symbol}`, true);
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

  async getRegistrationNonce(): Promise<{
    success: boolean;
    data: { registration_nonce: string };
  }> {
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
      body.chain_type = chainType;
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
      body.chain_type = chainType;
    }
    return this.post('/v1/orderly_key', body, false);
  }

  async getSupportedChains(
    brokerId: string
  ): Promise<{ success: boolean; data?: { chains: Array<{ chain_id: number }> } }> {
    return this.get(`/v1/public/chain_info?broker_id=${brokerId}`, false);
  }

  async getLeverage(symbol: string): Promise<unknown> {
    return this.get(`/v1/client/leverage?symbol=${symbol}`);
  }

  async setLeverage(symbol: string, leverage: number): Promise<unknown> {
    return this.post('/v1/client/leverage', { symbol, leverage });
  }

  async getTrades(symbol?: string, startT?: number, endT?: number): Promise<unknown> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    if (startT) params.append('start_t', startT.toString());
    if (endT) params.append('end_t', endT.toString());
    const queryString = params.toString();
    return this.get(queryString ? `/v1/trades?${queryString}` : '/v1/trades');
  }
}
