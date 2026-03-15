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

    const headers: Record<string, string> = {};

    // Set Content-Type based on method
    // GET/DELETE use application/x-www-form-urlencoded, others use application/json
    if (method === 'GET' || method === 'DELETE') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      headers['Content-Type'] = 'application/json';
    }

    if (requiresAuth) {
      const authHeaders = this.getSignatureHeaders(method, path, body);
      Object.assign(headers, authHeaders);
    }

    const requestConfig: AxiosRequestConfig = {
      method: config.method,
      url: config.url,
      headers,
    };

    if (config.data !== undefined) {
      requestConfig.data = config.data;
    }

    const response = await this.client.request<T>(requestConfig);

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

  async put<T>(path: string, data?: unknown, requiresAuth = true): Promise<T> {
    return this.request<T>({ method: 'PUT', url: path, data }, requiresAuth);
  }

  async getAccountInfo(): Promise<unknown> {
    return this.get('/v1/client/info');
  }

  async getBalances(): Promise<unknown> {
    return this.get('/v1/client/holding');
  }

  async getOrders(symbol?: string, status?: string): Promise<unknown> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    if (status) params.append('status', status);
    const queryString = params.toString();
    return this.get(queryString ? `/v1/orders?${queryString}` : '/v1/orders');
  }

  async getOrder(orderId: string): Promise<{
    success: boolean;
    data?: {
      order_id: number;
      symbol: string;
      price: number;
      quantity: number;
      side: string;
      status: string;
      type: string;
    };
  }> {
    return this.get(`/v1/order/${orderId}`);
  }

  async placeOrder(order: {
    symbol: string;
    order_type: string;
    side: string;
    order_quantity: string;
    order_price?: string;
    reduce_only?: boolean;
    client_order_id?: string;
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
    updates: {
      order_price?: string;
      order_quantity?: string;
      order_type: string;
      side: string;
    },
    symbol: string
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      order_id: orderId,
      symbol,
      order_type: updates.order_type,
      side: updates.side,
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

  async placeBatchOrder(
    orders: Array<{
      symbol: string;
      order_type: string;
      side: string;
      order_quantity: string;
      order_price?: string;
    }>
  ): Promise<unknown> {
    return this.post('/v1/batch-order', { orders });
  }

  async cancelBatchOrders(orderIds: string[]): Promise<unknown> {
    return this.delete(`/v1/batch-order?order_ids=${orderIds.join(',')}`);
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
      throw new Error(`No open position found for ${symbol}`);
    }

    const { position_qty } = positionResponse.data;
    if (!position_qty || position_qty === 0) {
      throw new Error(`No open position found for ${symbol}`);
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

    const isSolana = !userAddress.startsWith('0x');
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

  async getPositionHistory(symbol?: string, startT?: number, endT?: number): Promise<unknown> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    if (startT) params.append('start_t', startT.toString());
    if (endT) params.append('end_t', endT.toString());
    params.append('page', '1');
    params.append('limit', '25');
    const queryString = params.toString();
    return this.get(`/v1/position_history?${queryString}`);
  }

  async placeAlgoOrder(order: {
    symbol: string;
    type?: string;
    algoType: string;
    side?: string;
    quantity?: string;
    triggerPrice?: string;
    price?: string;
    callbackRate?: string;
    childOrders?: Array<{
      symbol: string;
      algo_type: string;
      side: string;
      type: string;
      trigger_price: string;
      price?: string;
      reduce_only: boolean;
    }>;
  }): Promise<unknown> {
    const body: Record<string, unknown> = {
      symbol: order.symbol,
      algo_type: order.algoType,
    };
    if (order.type !== undefined) {
      body.type = order.type;
    }
    if (order.side !== undefined) {
      body.side = order.side;
    }
    if (order.quantity !== undefined) {
      body.quantity = order.quantity;
    }
    if (order.triggerPrice !== undefined) {
      body.trigger_price = order.triggerPrice;
    }
    if (order.price !== undefined) {
      body.price = order.price;
    }
    if (order.callbackRate !== undefined) {
      body.callback_rate = order.callbackRate;
    }
    if (order.childOrders !== undefined) {
      body.child_orders = order.childOrders;
    }
    return this.post('/v1/algo/order', body);
  }

  async cancelAlgoOrder(orderId: string, symbol: string): Promise<unknown> {
    return this.delete(`/v1/algo/order?order_id=${orderId}&symbol=${symbol}`);
  }

  async cancelAllAlgoOrders(symbol?: string, algoType?: string): Promise<unknown> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    if (algoType) params.append('algo_type', algoType);
    const queryString = params.toString();
    return this.delete(queryString ? `/v1/algo/orders?${queryString}` : '/v1/algo/orders');
  }

  async getAlgoOrders(symbol?: string): Promise<unknown> {
    const path = symbol ? `/v1/algo/orders?symbol=${symbol}` : '/v1/algo/orders';
    return this.get(path);
  }

  async findAlgoOrderById(orderId: string): Promise<{
    success: boolean;
    data?: {
      algo_order_id: number;
      symbol: string;
      type: string;
      quantity: number;
      trigger_price?: number;
      algo_status: string;
    };
  }> {
    const result = (await this.get('/v1/algo/orders')) as {
      success: boolean;
      data?: {
        rows: Array<{
          algo_order_id: number;
          symbol: string;
          type: string;
          quantity: number;
          trigger_price?: number;
          algo_status: string;
        }>;
      };
    };
    if (!result.success || !result.data?.rows) {
      return { success: false };
    }
    const order = result.data.rows.find((r) => String(r.algo_order_id) === orderId);
    if (!order) {
      return { success: false };
    }
    return { success: true, data: order };
  }
}
