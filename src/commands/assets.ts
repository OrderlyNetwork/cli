import { parseUnits } from 'ethers';
import { createAuthenticatedClient } from '../lib/account-select.js';
import { OrderlyClient } from '../lib/api.js';
import { getWalletKey } from '../lib/keychain.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';
import {
  getChainInfo,
  getTokenAddress,
  isSupportedChain,
  getVerifyingContract,
} from '../lib/contracts.js';
import { createWalletFromPrivateKey, signWithdraw as signWithdrawEVM } from '../lib/evm.js';
import {
  createSolanaWalletFromPrivateKey,
  signWithdraw as signWithdrawSolana,
} from '../lib/solana.js';
import { hasNegativeUnsettledPnl, performSettlePnl } from './settle.js';

export async function getChains(
  network: Network,
  format: OutputFormat = 'json',
  brokerId?: string
): Promise<void> {
  const client = new OrderlyClient(network);

  try {
    const result = await client.get<{
      data?: { rows?: Array<{ broker_ids?: string[]; [k: string]: unknown }> };
    }>('/v1/public/chain_info', false);
    if (brokerId && result?.data?.rows) {
      result.data.rows = result.data.rows.filter(
        (chain) => chain.broker_ids && chain.broker_ids.includes(brokerId)
      );
    }
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getTokens(network: Network, format: OutputFormat = 'json'): Promise<void> {
  const client = new OrderlyClient(network);

  try {
    const result = await client.get('/v1/public/token', false);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function depositInfo(
  token: string,
  chainId: number,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const supported = await isSupportedChain(chainId, network);
  if (!supported) {
    error(
      `Chain ID ${chainId} is not supported on ${network}. Use 'orderly chains' to see supported chains.`
    );
  }

  const chainVault = await getChainInfo(chainId, network);
  const tokenAddress = await getTokenAddress(token, chainId, network);

  if (!chainVault) {
    error(`Chain ID ${chainId} not found in chain info.`);
  }

  const { vault_address, ...chainRest } = chainVault;
  const result: Record<string, unknown> = {
    ...chainRest,
    chainId,
    token: token.toUpperCase(),
    tokenAddress: tokenAddress ?? null,
    vaultAddress: vault_address ?? null,
  };
  output(result, format);
}

export async function withdraw(
  token: string,
  amount: string,
  receiver: string,
  chainId: number,
  accountId: string | undefined,
  network: Network,
  rawAmount: boolean = false,
  allowCrossChain: boolean = false,
  format: OutputFormat = 'json'
): Promise<void> {
  const { keyPair, client } = await createAuthenticatedClient(accountId, network);

  const brokerId = await client.getBrokerId(keyPair!.accountId);

  const supported = await isSupportedChain(chainId, network);
  if (!supported) {
    error(
      `Chain ID ${chainId} is not supported on ${network}. Use 'orderly chains' to see supported chains.`
    );
  }

  let rawAmountValue: string;

  if (rawAmount) {
    if (!amount || isNaN(Number(amount))) {
      error(`Invalid amount: ${amount}`, ['Amount must be a valid positive number.']);
    }
    rawAmountValue = amount;
  } else {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      error(`Invalid amount: ${amount}`, ['Amount must be a valid positive number (e.g., 10.5)']);
    }
    try {
      const tokensResponse = await client.get<{
        success: boolean;
        data?: {
          rows: Array<{
            token: string;
            decimals: number;
            chain_details: Array<{ chain_id: number | string; decimals: number }>;
          }>;
        };
      }>('/v1/public/token');

      if (!tokensResponse.success || !tokensResponse.data?.rows) {
        error('Failed to fetch token info');
      }

      const tokenInfo = tokensResponse.data.rows.find((t) => t.token === token.toUpperCase());

      if (!tokenInfo) {
        error(`Token ${token.toUpperCase()} not found`);
      }

      const chainDetail = tokenInfo.chain_details.find(
        (c) => String(c.chain_id) === String(chainId)
      );
      const decimals = chainDetail?.decimals ?? tokenInfo.decimals;

      rawAmountValue = parseUnits(amount, decimals).toString();
    } catch {
      error(`Invalid amount: ${amount}`, ['Amount must be a valid number (e.g., 10.5)']);
    }
  }

  try {
    try {
      if (await hasNegativeUnsettledPnl(client)) {
        const settleResult = await performSettlePnl(client, keyPair!, network);
        if (settleResult) {
          output({ auto_settled: true, settle_pnl_id: settleResult.settle_pnl_id }, format);
        }
      }
    } catch {
      // settle-pnl is best-effort; don't let it mask the real withdrawal error
    }

    const nonceResponse = await client.get<{ success: boolean; data?: { withdraw_nonce: string } }>(
      '/v1/withdraw_nonce'
    );

    if (!nonceResponse.success || !nonceResponse.data?.withdraw_nonce) {
      error('Failed to get withdrawal nonce');
    }

    const withdrawNonce = String(nonceResponse.data.withdraw_nonce);
    const timestamp = Date.now();
    const timestampStr = timestamp.toString();

    const walletKey = await getWalletKey(keyPair.address, network);
    if (!walletKey) {
      error(
        `No wallet key found for address ${keyPair.address}. Wallet keys are required for withdrawal signing. Use orderly wallet-import to import your wallet key.`
      );
    }

    const walletType = walletKey.walletType || keyPair.walletType || 'EVM';

    let signature: string;
    let message: Record<string, unknown>;

    if (walletType === 'SOL') {
      const solanaWallet = createSolanaWalletFromPrivateKey(walletKey.privateKey, network);
      const withdrawResult = await signWithdrawSolana(solanaWallet, {
        brokerId,
        chainId,
        receiver,
        token: token.toUpperCase(),
        amount: rawAmountValue,
        withdrawNonce,
        timestamp,
      });
      signature = withdrawResult.signature;
      message = withdrawResult.message;
    } else {
      const evmWallet = createWalletFromPrivateKey(walletKey.privateKey);
      const withdrawMessage = {
        brokerId,
        chainId,
        receiver,
        token: token.toUpperCase(),
        amount: rawAmountValue,
        withdrawNonce,
        timestamp: timestampStr,
      };
      signature = await signWithdrawEVM(evmWallet, withdrawMessage, network);
      message = withdrawMessage;
    }

    const requestBody: Record<string, unknown> = {
      message,
      signature,
      userAddress: keyPair.address,
      verifyingContract: getVerifyingContract(network),
    };
    if (allowCrossChain) {
      requestBody.allow_cross_chain_withdrawal = true;
    }

    const result = (await client.post<{
      success: boolean;
      data?: { withdraw_id: number };
      message?: string;
    }>('/v1/withdraw_request', requestBody)) as {
      success?: boolean;
      data?: { withdraw_id: number };
      message?: string;
    };

    if (result.success && result.data?.withdraw_id) {
      output(result.data, format);
    } else {
      const apiMsg = (result as Record<string, unknown>).message as string | undefined;
      error(`Failed to initiate withdrawal${apiMsg ? `: ${apiMsg}` : ''}`, [
        'If the error mentions cross-chain, use --allow-cross-chain flag.',
      ]);
    }
  } catch (err) {
    handleError(err);
  }
}

export async function assetHistory(
  token: string | undefined,
  side: string | undefined,
  status: string | undefined,
  page: number | undefined,
  size: number | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const params = new URLSearchParams();
    if (token) params.append('token', token.toUpperCase());
    if (side) params.append('side', side.toUpperCase());
    if (status) params.append('status', status.toUpperCase());
    params.append('page', (page ?? 1).toString());
    params.append('size', (size ?? 25).toString());

    const result = await client.get(`/v1/asset/history?${params.toString()}`);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
