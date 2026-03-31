import { OrderlyClient } from '../lib/api.js';
import { createAuthenticatedClient } from '../lib/account-select.js';
import { getWalletKey } from '../lib/keychain.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
import { KeyPair, Network } from '../types.js';
import { createWalletFromPrivateKey, signSettlePnl as signSettlePnlEVM } from '../lib/evm.js';
import {
  createSolanaWalletFromPrivateKey,
  signSettlePnl as signSettlePnlSolana,
  getSolanaChainId,
} from '../lib/solana.js';

const VERIFYING_CONTRACTS: Record<string, string> = {
  mainnet: '0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203',
  testnet: '0x1826B75e2ef249173FC735149AE4B8e9ea10abff',
};

export interface SettleResult {
  settle_pnl_id: number;
}

export async function performSettlePnl(
  client: OrderlyClient,
  keyPair: KeyPair,
  network: Network
): Promise<SettleResult> {
  const brokerId = await client.getBrokerId(keyPair.accountId);

  const nonceResponse = await client.getSettleNonce();
  if (!nonceResponse.success || nonceResponse.data?.settle_nonce === undefined) {
    throw new Error('Failed to get settle nonce from API');
  }

  const settleNonce = String(nonceResponse.data.settle_nonce);

  const walletKey = await getWalletKey(keyPair.address, network);
  if (!walletKey) {
    throw new Error(`No wallet key found for ${keyPair.address}`);
  }

  const walletType = walletKey.walletType || keyPair.walletType || 'EVM';
  const chainId =
    walletType === 'SOL' ? getSolanaChainId(network) : network === 'mainnet' ? 42161 : 421614;

  let signature: string;
  let message: Record<string, unknown>;

  const timestamp = Date.now();

  if (walletType === 'SOL') {
    const solanaWallet = createSolanaWalletFromPrivateKey(walletKey.privateKey, network);
    const result = await signSettlePnlSolana(solanaWallet, {
      brokerId,
      chainId,
      settleNonce,
      timestamp,
    });
    signature = result.signature;
    message = result.message;
  } else {
    const settleMessage = {
      brokerId,
      chainId,
      settleNonce,
      timestamp,
    };
    const evmWallet = createWalletFromPrivateKey(walletKey.privateKey);
    signature = await signSettlePnlEVM(evmWallet, settleMessage, network);
    message = settleMessage;
  }

  const result = await client.post<{
    success: boolean;
    data?: { settle_pnl_id: number };
    message?: string;
  }>('/v1/settle_pnl', {
    message,
    signature,
    userAddress: keyPair.address,
    verifyingContract: VERIFYING_CONTRACTS[network],
  });

  if (result.success && result.data?.settle_pnl_id) {
    return result.data;
  }

  const msg =
    (result as { message?: string }).message ||
    (result as { code?: number }).code?.toString() ||
    'Unknown error';
  throw new Error(`Settle PnL failed: ${msg}`);
}

export async function hasNegativeUnsettledPnl(client: OrderlyClient): Promise<boolean> {
  try {
    const positions = (await client.get('/v1/positions')) as {
      data?: {
        rows?: Array<{ unsettled_pnl?: number }>;
      };
    };
    const rows = positions?.data?.rows;
    if (!rows || rows.length === 0) return false;
    return rows.some((row) => row.unsettled_pnl !== undefined && row.unsettled_pnl < 0);
  } catch {
    return false;
  }
}

export async function settlePnl(
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { keyPair, client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await performSettlePnl(client, keyPair, network);
    if (result) {
      output(result, format);
    } else {
      error('Failed to settle PnL');
    }
  } catch (err) {
    handleError(err);
  }
}

export async function settlePnlHistory(
  page: number | undefined,
  size: number | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.getPnlSettlementHistory(page, size);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
