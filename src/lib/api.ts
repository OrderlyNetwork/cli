import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { sign } from './crypto.js';
import { KeyPair, OrderlyConfig } from '../types.js';
import { loadConfig } from './config.js';

export class OrderlyClient {
  private client: AxiosInstance;
  private keyPair: KeyPair | null = null;

  constructor(config?: Partial<OrderlyConfig>) {
    const fullConfig = { ...loadConfig(), ...config };
    this.client = axios.create({
      baseURL: fullConfig.apiBaseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });
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
}
