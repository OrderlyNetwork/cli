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
import {
  createWalletFromPrivateKey,
  isValidEVMAddress,
  signWithdraw as signWithdrawEVM,
} from '../lib/evm.js';
import {
  createSolanaWalletFromPrivateKey,
  isValidSolanaAddress,
  signWithdraw as signWithdrawSolana,
} from '../lib/solana.js';
import { hasNegativeUnsettledPnl, performSettlePnl } from './settle.js';

export async function getChains(
  network: Network,
  format: OutputFormat = 'json',
  brokerId?: string,
  verbose = false
): Promise<void> {
  const client = new OrderlyClient(network);

  try {
    const result = await client.get<{
      data?: { rows?: Array<{ broker_ids?: string[]; [k: string]: unknown }> };
    }>('/v1/public/chain_info', false);
    if (result?.data?.rows) {
      if (brokerId) {
        result.data.rows = result.data.rows.filter(
          (chain) => chain.broker_ids && chain.broker_ids.includes(brokerId)
        );
      }
      if (!verbose) {
        result.data.rows = result.data.rows.map(({ broker_ids: _broker_ids, ...rest }) => rest);
      }
    }
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getTokens(
  network: Network,
  format: OutputFormat = 'json',
  verbose = false
): Promise<void> {
  const client = new OrderlyClient(network);

  try {
    const result = await client.get<{
      success?: boolean;
      data?: { rows?: Array<{ chain_details?: unknown[]; [k: string]: unknown }> };
    }>('/v1/public/token', false);
    if (!verbose && result?.data?.rows) {
      result.data.rows = result.data.rows.map(({ chain_details: _chain_details, ...rest }) => rest);
    }
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
  if (!chainVault) {
    error(`Chain ID ${chainId} not found in chain info.`);
  }

  const tokenAddress = await getTokenAddress(token, chainId, network);
  if (!tokenAddress) {
    error(`Token ${token.toUpperCase()} is not available on chain ${chainId}.`, [
      "Use 'orderly tokens' to see supported tokens and 'orderly chains' to see supported chains.",
    ]);
  }

  const { vault_address, ...chainRest } = chainVault;
  const result: Record<string, unknown> = {
    ...chainRest,
    chainId,
    token: token.toUpperCase(),
    tokenAddress,
    vaultAddress: vault_address ?? null,
  };
  output(result, format);
}

export async function withdraw(
  token: string,
  amount: string,
  receiver: string | undefined,
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
    let settledPnlId: number | null = null;
    try {
      if (await hasNegativeUnsettledPnl(client)) {
        const settleResult = await performSettlePnl(client, keyPair!, network);
        if (settleResult) {
          settledPnlId = settleResult.settle_pnl_id;
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

    const resolvedReceiver = receiver || walletKey.address;
    const walletType = walletKey.walletType || keyPair.walletType || 'EVM';

    if (walletType === 'SOL' && isValidEVMAddress(resolvedReceiver)) {
      error(`Cannot withdraw to an EVM address (${resolvedReceiver}) using a Solana wallet.`, [
        'Solana wallets can only withdraw to Solana (base58) addresses.',
        'To withdraw to an EVM chain, use an EVM wallet account instead.',
      ]);
    }

    if (walletType === 'EVM' && !isValidEVMAddress(resolvedReceiver)) {
      if (isValidSolanaAddress(resolvedReceiver)) {
        error(`Cannot withdraw to a Solana address (${resolvedReceiver}) using an EVM wallet.`, [
          'EVM wallets can only withdraw to EVM (0x...) addresses.',
          'To withdraw to a Solana chain, use a Solana wallet account instead.',
        ]);
      }
    }

    let signature: string;
    let message: Record<string, unknown>;

    if (walletType === 'SOL') {
      const solanaWallet = createSolanaWalletFromPrivateKey(walletKey.privateKey, network);
      const withdrawResult = await signWithdrawSolana(solanaWallet, {
        brokerId,
        chainId,
        receiver: resolvedReceiver,
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
        receiver: resolvedReceiver,
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
      const out = { ...result.data };
      if (settledPnlId !== null) {
        (out as Record<string, unknown>).auto_settled = true;
        (out as Record<string, unknown>).settle_pnl_id = settledPnlId;
      }
      output(out, format);
    } else {
      const apiMsg = (result as Record<string, unknown>).message as string | undefined;
      const hints: string[] = [];
      if (allowCrossChain) {
        hints.push('Check that the token and chain combination is valid.');
      } else {
        hints.push('If the error mentions cross-chain, use --allow-cross-chain flag.');
      }
      if (apiMsg && /amount/i.test(apiMsg)) {
        hints.push(
          'The amount may be below the minimum withdrawal or exceed your available balance.'
        );
      }
      error(`Failed to initiate withdrawal${apiMsg ? `: ${apiMsg}` : ''}`, hints);
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
