import kleur from 'kleur';
import axios from 'axios';
import { parseUnits } from 'ethers';
import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey, getWalletKey } from '../lib/keychain.js';
import { output, OutputFormat } from '../lib/output.js';
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
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.log(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.log(kleur.red(error.message));
    }
  }
}

export async function getTokens(network: Network, format: OutputFormat = 'json'): Promise<void> {
  const client = new OrderlyClient(network);

  try {
    const result = await client.get('/v1/public/token', false);
    output(result, format);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.log(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.log(kleur.red(error.message));
    }
  }
}

export async function depositInfo(
  token: string,
  chainId: number,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  if (!isSupportedChain(chainId, network)) {
    console.log(
      kleur.red(
        `Chain ID ${chainId} is not supported on ${network}. Use 'orderly chains' to see supported chains.`
      )
    );
    return;
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
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
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
        console.log(kleur.red('Failed to fetch token info'));
        return;
      }

      const tokenInfo = tokensResponse.data.rows.find((t) => t.token === token.toUpperCase());

      if (!tokenInfo) {
        console.log(kleur.red(`Token ${token.toUpperCase()} not found`));
        return;
      }

      rawAmountValue = parseUnits(amount, tokenInfo.decimals).toString();
    } catch (error) {
      if (error instanceof Error && error.message.includes('fractional component')) {
        console.log(kleur.red(`Invalid amount: ${amount}`));
        console.log(kleur.dim('Amount must be a valid number (e.g., 10.5)'));
        return;
      }
      throw error;
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
      console.log(kleur.red('Failed to get withdrawal nonce'));
      return;
    }

    const withdrawNonce = String(nonceResponse.data.withdraw_nonce);
    const timestamp = Date.now();
    const timestampStr = timestamp.toString();

    const walletKey = await getWalletKey(keyPair.address, network);
    if (!walletKey) {
      console.log(kleur.red(`No wallet key found for address ${keyPair.address}`));
      console.log(kleur.yellow('Wallet keys are required for withdrawal signing.'));
      console.log(kleur.yellow('Use `orderly wallet-import` to import your wallet key.'));
      return;
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
      console.log(kleur.red('Failed to initiate withdrawal'));
      output(result, 'json');
    }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.log(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.log(kleur.red(error.message));
    }
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
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
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
      console.log(kleur.red('Failed to initiate withdrawal'));
      console.log(kleur.dim('Response:'), result);
    }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.log(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.log(kleur.red(error.message));
    }
  }
}

export async function assetHistory(
  token: string | undefined,
  side: string | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    let path = '/v1/asset/history?page=1&size=20';
    if (token) path += `&token=${token.toUpperCase()}`;
    if (side) path += `&side=${side.toUpperCase()}`;

    const result = await client.get(path);
    output(result, format);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.log(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.log(kleur.red(error.message));
    }
  }
}
