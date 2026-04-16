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

  async getBrokerId(accountId: string): Promise<string> {
    const result = (await this.get(`/v1/public/account?account_id=${accountId}`, false)) as {
      data?: { broker_id?: string };
    };
    if (!result.data?.broker_id) {
      throw new Error(`Could not resolve broker_id for account ${accountId}`);
    }
    return result.data.broker_id;
  }

  async getBalances(): Promise<unknown> {
    return this.get('/v1/client/holding');
  }

  async getStatistics(): Promise<unknown> {
    return this.get('/v1/client/statistics');
  }

  async getOrders(
    symbol?: string,
    status?: string,
    side?: string,
    orderType?: string,
    sortBy?: string,
    page?: number,
    size?: number
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    if (status) params.append('status', status);
    if (side) params.append('side', side);
    if (orderType) params.append('order_type', orderType);
    if (sortBy) params.append('sort_by', sortBy);
    if (page) params.append('page', page.toString());
    if (size) params.append('size', size.toString());
    const queryString = params.toString();
    return this.get(queryString ? `/v1/orders?${queryString}` : '/v1/orders');
  }

  async getOrder(orderId: string): Promise<{
    success: boolean;
    data?: Record<string, unknown>;
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
    updates: Record<string, unknown>,
    symbol: string
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      order_id: Number(orderId),
      symbol,
      ...updates,
    };
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

  async cancelBatchOrdersByClientIds(clientOrderIds: string[]): Promise<unknown> {
    return this.delete(`/v1/client/batch-order?client_order_ids=${clientOrderIds.join(',')}`);
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

  async closePosition(symbol: string, partialQuantity?: number): Promise<unknown> {
    const positionResponse = await this.getPosition(symbol);
    if (!positionResponse.success || !positionResponse.data) {
      throw new Error(`No open position found for ${symbol}`);
    }

    const { position_qty } = positionResponse.data;
    if (!position_qty || position_qty === 0) {
      throw new Error(`No open position found for ${symbol}`);
    }

    const side = position_qty > 0 ? 'SELL' : 'BUY';
    const absQty = Math.abs(position_qty);

    if (partialQuantity !== undefined) {
      if (partialQuantity <= 0) {
        throw new Error('Quantity must be positive');
      }
      if (partialQuantity > absQty) {
        throw new Error(`Quantity ${partialQuantity} exceeds position size ${absQty}`);
      }
    }

    const quantity = partialQuantity !== undefined ? partialQuantity.toString() : absQty.toString();

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

  async getMarketTrades(symbol: string, limit?: number): Promise<unknown> {
    const params = new URLSearchParams();
    params.append('symbol', symbol);
    if (limit) params.append('limit', limit.toString());
    return this.get(`/v1/public/market_trades?${params.toString()}`, false);
  }

  async getFundingRates(): Promise<unknown> {
    return this.get('/v1/public/market_info/funding_history', false);
  }

  async getSymbols(): Promise<unknown> {
    return this.get('/v1/public/info', false);
  }

  async getFutures(): Promise<unknown> {
    return this.get('/v1/public/futures', false);
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

  async getSupportedChains(): Promise<{
    success: boolean;
    data?: { chains: Array<{ chain_id: number }> };
  }> {
    return this.get('/v1/public/chain_info', false);
  }

  async getLeverage(symbol: string): Promise<unknown> {
    return this.get(`/v1/client/leverage?symbol=${symbol}`);
  }

  async setLeverage(symbol: string, leverage: number): Promise<unknown> {
    return this.post('/v1/client/leverage', { symbol, leverage });
  }

  async getTrades(
    symbol?: string,
    startT?: number,
    endT?: number,
    page?: number,
    size?: number
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    if (startT) params.append('start_t', startT.toString());
    if (endT) params.append('end_t', endT.toString());
    if (page) params.append('page', page.toString());
    if (size) params.append('size', size.toString());
    const queryString = params.toString();
    return this.get(queryString ? `/v1/trades?${queryString}` : '/v1/trades');
  }

  async getPositionHistory(
    symbol?: string,
    startT?: number,
    endT?: number,
    page?: number,
    limit?: number
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    if (startT) params.append('start_t', startT.toString());
    if (endT) params.append('end_t', endT.toString());
    params.append('page', (page ?? 1).toString());
    params.append('limit', (limit ?? 25).toString());
    const queryString = params.toString();
    const result = (await this.get(`/v1/position_history?${queryString}`)) as {
      data?: { rows?: unknown[] | null; meta?: unknown };
    };
    if (result?.data && result.data.rows === null) {
      result.data.rows = [];
    }
    return result;
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
    reduceOnly?: boolean;
    childOrders?: Array<Record<string, unknown>>;
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
    if (order.reduceOnly) {
      body.reduce_only = true;
    }
    if (order.childOrders !== undefined) {
      body.child_orders = order.childOrders;
    }
    return this.post('/v1/algo/order', body);
  }

  async cancelAlgoOrderByClientId(clientOrderId: string, symbol: string): Promise<unknown> {
    return this.delete(
      `/v1/algo/client/order?client_order_id=${encodeURIComponent(clientOrderId)}&symbol=${symbol}`
    );
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

  async getAlgoOrders(
    symbol?: string,
    status?: string,
    page?: number,
    size?: number
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    if (status) params.append('status', status);
    if (page) params.append('page', page.toString());
    if (size) params.append('size', size.toString());
    const queryString = params.toString();
    return this.get(queryString ? `/v1/algo/orders?${queryString}` : '/v1/algo/orders');
  }

  async editAlgoOrder(
    orderId: string,
    updates: {
      price?: number;
      quantity?: number;
      trigger_price?: number;
      callback_rate?: number;
    },
    symbol: string
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      order_id: Number(orderId),
      symbol,
    };
    if (updates.price !== undefined) body.price = updates.price;
    if (updates.quantity !== undefined) body.quantity = updates.quantity;
    if (updates.trigger_price !== undefined) body.trigger_price = updates.trigger_price;
    if (updates.callback_rate !== undefined) body.callback_rate = updates.callback_rate;
    return this.put('/v1/algo/order', body);
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
      algo_type: string;
      root_algo_order_id: number;
      parent_algo_order_id: number;
      child_orders?: Array<{
        algo_order_id: number;
        symbol: string;
        algo_type: string;
        algo_status: string;
        side: string;
        type: string;
        trigger_price?: number;
        quantity: number;
      }>;
    };
  }> {
    return this.get(`/v1/algo/order/${orderId}`) as Promise<{
      success: boolean;
      data?: {
        algo_order_id: number;
        symbol: string;
        type: string;
        quantity: number;
        trigger_price?: number;
        algo_status: string;
        algo_type: string;
        root_algo_order_id: number;
        parent_algo_order_id: number;
        child_orders?: Array<{
          algo_order_id: number;
          symbol: string;
          algo_type: string;
          algo_status: string;
          side: string;
          type: string;
          trigger_price?: number;
          quantity: number;
        }>;
      };
    }>;
  }

  async getSettleNonce(): Promise<{
    success: boolean;
    data?: { settle_nonce: number };
  }> {
    return this.get('/v1/settle_nonce') as Promise<{
      success: boolean;
      data?: { settle_nonce: number };
    }>;
  }

  async getPnlSettlementHistory(page?: number, size?: number): Promise<unknown> {
    const params = new URLSearchParams();
    params.append('page', (page ?? 1).toString());
    params.append('size', (size ?? 25).toString());
    return this.get(`/v1/pnl_settlement/history?${params.toString()}`);
  }

  async getReferralInfo(): Promise<unknown> {
    return this.get('/v1/referral/info');
  }

  async getDistributionHistory(
    status?: string,
    type?: string,
    startT?: number,
    endT?: number,
    page?: number,
    size?: number
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (type) params.append('type', type);
    if (startT) params.append('start_t', startT.toString());
    if (endT) params.append('end_t', endT.toString());
    params.append('page', (page ?? 1).toString());
    params.append('size', (size ?? 25).toString());
    const queryString = params.toString();
    return this.get(
      queryString
        ? `/v1/client/distribution_history?${queryString}`
        : '/v1/client/distribution_history'
    );
  }

  async getVolumeStats(): Promise<unknown> {
    return this.get('/v1/volume/user/stats');
  }

  async getNotificationInbox(type?: string, page?: number, size?: number): Promise<unknown> {
    const params = new URLSearchParams();
    if (type) params.append('type', type);
    params.append('page', (page ?? 1).toString());
    params.append('size', (size ?? 25).toString());
    return this.get(`/v1/notification/inbox/notifications?${params.toString()}`);
  }

  async getNotificationInboxUnread(): Promise<unknown> {
    return this.get('/v1/notification/inbox/unread');
  }

  async cancelOrderByClientId(clientOrderId: string, symbol: string): Promise<unknown> {
    return this.delete(
      `/v1/client/order?client_order_id=${encodeURIComponent(clientOrderId)}&symbol=${symbol}`
    );
  }

  async getOrderByOrderId(orderId: string): Promise<unknown> {
    return this.get(`/v1/order/${orderId}`);
  }

  async getOrderByClientId(clientOrderId: string): Promise<unknown> {
    return this.get(`/v1/client/order/${encodeURIComponent(clientOrderId)}`);
  }

  async getOrderTrades(orderId: string): Promise<unknown> {
    return this.get(`/v1/order/${orderId}/trades`);
  }

  async getAlgoOrderTrades(orderId: string): Promise<unknown> {
    return this.get(`/v1/algo/order/${orderId}/trades`);
  }

  async getLiquidations(symbol?: string, page?: number, size?: number): Promise<unknown> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    if (page) params.append('page', page.toString());
    if (size) params.append('size', size.toString());
    const queryString = params.toString();
    return this.get(queryString ? `/v1/liquidations?${queryString}` : '/v1/liquidations');
  }

  async getPriceChanges(): Promise<unknown> {
    return this.get('/v1/public/market_info/price_changes', false);
  }

  async getOpenInterest(): Promise<unknown> {
    return this.get('/v1/public/market_info/traders_open_interests', false);
  }

  async getLiquidatedPositions(symbol?: string, page?: number, size?: number): Promise<unknown> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    if (page) params.append('page', page.toString());
    if (size) params.append('size', size.toString());
    const queryString = params.toString();
    return this.get(
      queryString
        ? `/v1/public/liquidated_positions?${queryString}`
        : '/v1/public/liquidated_positions',
      false
    );
  }

  async getSystemInfo(): Promise<unknown> {
    return this.get('/v1/public/system_info', false);
  }

  async getKeyInfo(): Promise<unknown> {
    return this.get('/v1/client/key_info');
  }
}
