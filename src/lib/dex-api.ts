import axios, { AxiosInstance } from 'axios';
import { Network } from '../types.js';
import { createWalletFromPrivateKey, normalizePrivateKey } from './evm.js';
import { getWalletKey } from './keychain.js';

const DEX_API_BASE_URLS: Record<Network, string> = {
  mainnet: 'https://dex-api.orderly.network',
  testnet: 'https://testnet-dex-api.orderly.network',
};

export interface FeeOption {
  amount: number;
  currency: string;
  stable: boolean;
  currentPrice?: number;
}

export interface FeeOptions {
  usdc: FeeOption;
  usdt: FeeOption;
  order: FeeOption;
  receiverAddress: string;
}

export interface VerifyTxPayload {
  txHash: string;
  chain: string;
  chainId: number;
  chain_type: 'EVM' | 'SOL';
  brokerId: string;
  makerFee: number;
  takerFee: number;
  rwaMakerFee: number;
  rwaTakerFee: number;
  paymentType: 'usdc' | 'usdt' | 'order';
}

export interface VerifyTxResult {
  success: boolean;
  message: string;
  amount?: number;
  brokerCreationData?: {
    brokerId: string;
    transactionHashes?: Record<string, string>;
  };
}

export class DexApiClient {
  private client: AxiosInstance;
  private network: Network;
  private token: string | null = null;

  constructor(network: Network) {
    this.network = network;
    this.client = axios.create({
      baseURL: DEX_API_BASE_URLS[network],
    });
  }

  async authenticate(address: string): Promise<void> {
    const walletKey = await getWalletKey(address, this.network);
    if (!walletKey) {
      throw new Error(`No wallet found for ${address} on ${this.network}`);
    }
    if (walletKey.walletType !== 'EVM') {
      throw new Error('Dex API authentication requires an EVM wallet.');
    }

    const evmWallet = createWalletFromPrivateKey(normalizePrivateKey(walletKey.privateKey));

    const nonceRes = await this.client.post('/api/auth/nonce', { address: evmWallet.address });
    const { message } = nonceRes.data;

    const signature = await evmWallet.signMessage(message);

    const verifyRes = await this.client.post('/api/auth/verify', {
      address: evmWallet.address,
      signature,
    });

    this.token = verifyRes.data.token;
  }

  private authHeaders(): Record<string, string> {
    if (!this.token) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  async getFeeOptions(isCustom = true): Promise<FeeOptions> {
    const params = isCustom ? '?isCustom=true' : '';
    const res = await this.client.get(`/api/graduation/fee-options${params}`, {
      headers: this.authHeaders(),
    });
    return res.data;
  }

  async getDex(): Promise<{ exists: boolean; integrationType?: string; brokerId?: string; brokerName?: string; isGraduated?: boolean; repoUrl?: string | null }> {
    try {
      const res = await this.client.get('/api/dex', {
        headers: this.authHeaders(),
      });
      if (res.data.exists === false) {
        return { exists: false };
      }
      return {
        exists: true,
        integrationType: res.data.integrationType,
        brokerId: res.data.brokerId,
        brokerName: res.data.brokerName,
        isGraduated: res.data.isGraduated,
        repoUrl: res.data.repoUrl,
      };
    } catch {
      return { exists: false };
    }
  }

  async createCustomDex(brokerName?: string): Promise<void> {
    const formData = new FormData();
    formData.append('integrationType', 'custom');
    if (brokerName) {
      formData.append('brokerName', brokerName);
    }

    await this.client.post('/api/dex', formData, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async verifyTx(payload: VerifyTxPayload): Promise<VerifyTxResult> {
    const res = await this.client.post('/api/graduation/verify-tx', payload, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
    });
    return res.data;
  }

  async finalizeAdminWallet(): Promise<{ success: boolean; message: string; isGraduated: boolean }> {
    const res = await this.client.post('/api/graduation/finalize-admin-wallet', {}, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
    });
    return res.data;
  }
}
