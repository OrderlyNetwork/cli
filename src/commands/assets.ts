import kleur from 'kleur';
import { parseUnits } from 'ethers';
import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey, getWalletKey } from '../lib/keychain.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';
import { getContractAddresses, isSupportedChain } from '../lib/contracts.js';
import { createWalletFromPrivateKey, signWithdraw as signWithdrawEVM } from '../lib/evm.js';
import {
  createSolanaWalletFromPrivateKey,
  signWithdraw as signWithdrawSolana,
} from '../lib/solana.js';

const VERIFYING_CONTRACTS = {
  mainnet: '0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203',
  testnet: '0x1826B75e2ef249173FC735149AE4B8e9ea10abff',
};

export async function getChains(network: Network, format: OutputFormat = 'json'): Promise<void> {
  const client = new OrderlyClient(network);

  try {
    const result = await client.get('/v1/public/chain_info?broker_id=demo', false);
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
  if (!isSupportedChain(chainId, network)) {
    error(
      `Chain ID ${chainId} is not supported on ${network}. Use 'orderly chains' to see supported chains.`
    );
  }

  const addresses = getContractAddresses(chainId, network);
  const result = {
    chain: addresses.name,
    chainId,
    token: token.toUpperCase(),
    tokenAddress: addresses.usdc,
    vaultAddress: addresses.vault,
  };
  output(result, format);
}

export async function withdraw(
  token: string,
  amount: string,
  receiver: string,
  chainId: number,
  brokerId: string,
  accountId: string | undefined,
  network: Network,
  rawAmount: boolean = false
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  let rawAmountValue: string;

  if (rawAmount) {
    rawAmountValue = amount;
  } else {
    try {
      const tokensResponse = await client.get<{
        success: boolean;
        data?: { rows: Array<{ token: string; decimals: number }> };
      }>('/v1/public/token');

      if (!tokensResponse.success || !tokensResponse.data?.rows) {
        error('Failed to fetch token info');
      }

      const tokenInfo = tokensResponse.data.rows.find((t) => t.token === token.toUpperCase());

      if (!tokenInfo) {
        error(`Token ${token.toUpperCase()} not found`);
      }

      rawAmountValue = parseUnits(amount, tokenInfo.decimals).toString();
    } catch (err) {
      if (err instanceof Error && err.message.includes('fractional component')) {
        error(`Invalid amount: ${amount}`, ['Amount must be a valid number (e.g., 10.5)']);
      }
      throw err;
    }
  }

  console.log(kleur.cyan(`\n💸 Withdraw ${amount} ${token} to ${receiver}\n`));
  if (!rawAmount) {
    console.log(kleur.dim(`Raw amount: ${rawAmountValue}`));
  }

  try {
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

    console.log(kleur.dim('Signing withdrawal with stored wallet key...'));

    const result = await client.post<{
      success: boolean;
      data?: { withdraw_id: number };
      message?: string;
    }>('/v1/withdraw_request', {
      message,
      signature,
      userAddress: keyPair.address,
      verifyingContract: VERIFYING_CONTRACTS[network],
    });

    if (result.success && result.data?.withdraw_id) {
      console.log(kleur.green('✅ Withdrawal initiated successfully!'));
      console.log(kleur.dim(`Withdrawal ID: ${result.data.withdraw_id}`));
      console.log();
      console.log(kleur.dim('Check status with:'));
      console.log(kleur.cyan(`  orderly asset-history --side WITHDRAW`));
    } else {
      error('Failed to initiate withdrawal');
    }
  } catch (err) {
    handleError(err);
  }
}

export async function withdrawSubmit(
  token: string,
  amount: string,
  receiver: string,
  chainId: number,
  brokerId: string,
  signature: string,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  console.log(kleur.cyan('\n📤 Submit Withdrawal Request\n'));
  console.log(
    kleur.yellow('Note: withdraw-submit is deprecated. Use `withdraw` which auto-signs.')
  );

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  const timestamp = Date.now();
  const message = {
    brokerId,
    chainId,
    receiver,
    token: token.toUpperCase(),
    amount,
    timestamp,
  };

  try {
    const result = await client.post<{
      success: boolean;
      data?: { withdraw_id: number };
      message?: string;
    }>('/v1/withdraw_request', {
      message,
      signature,
      userAddress: keyPair.accountId,
      verifyingContract: VERIFYING_CONTRACTS[network],
    });

    if (result.success && result.data?.withdraw_id) {
      console.log(kleur.green('✅ Withdrawal initiated successfully!'));
      console.log(kleur.dim(`Withdrawal ID: ${result.data.withdraw_id}`));
      console.log();
      console.log(kleur.dim('Withdrawal status can be checked with:'));
      console.log(kleur.cyan(`  orderly asset-history --side WITHDRAW`));
    } else {
      error('Failed to initiate withdrawal');
    }
  } catch (err) {
    handleError(err);
  }
}

export async function assetHistory(
  token: string | undefined,
  side: string | undefined,
  page: number | undefined,
  size: number | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const params = new URLSearchParams();
    if (token) params.append('token', token.toUpperCase());
    if (side) params.append('side', side.toUpperCase());
    params.append('page', (page ?? 1).toString());
    params.append('size', (size ?? 20).toString());

    const result = await client.get(`/v1/asset/history?${params.toString()}`);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
