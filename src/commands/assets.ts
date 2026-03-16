import kleur from 'kleur';
import axios from 'axios';
import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey } from '../lib/keychain.js';
import { output, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';
import { getContractAddresses, isSupportedChain } from '../lib/contracts.js';

const EIP712_DOMAIN = {
  name: 'Orderly',
  version: '1',
};

const VERIFYING_CONTRACTS = {
  mainnet: '0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203',
  testnet: '0x1826B75e2ef249173FC735149AE4B8e9ea10abff',
};

const WITHDRAW_TYPES = {
  Withdraw: [
    { name: 'brokerId', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'receiver', type: 'address' },
    { name: 'token', type: 'string' },
    { name: 'amount', type: 'uint256' },
    { name: 'withdrawNonce', type: 'uint64' },
    { name: 'timestamp', type: 'uint64' },
  ],
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

export async function depositInfo(token: string, chainId: number, network: Network): Promise<void> {
  console.log(kleur.cyan(`\n📥 Deposit Info for ${token} (Chain ${chainId})\n`));

  if (!isSupportedChain(chainId, network)) {
    console.log(kleur.red(`Chain ID ${chainId} is not supported on ${network}`));
    console.log(kleur.dim('Use `orderly chains` to see supported chains'));
    return;
  }

  try {
    const addresses = getContractAddresses(chainId, network);
    console.log(`Chain:          ${addresses.name}`);
    console.log(`Token:          ${token.toUpperCase()}`);
    console.log(`Token Address:  ${addresses.usdc}`);
    console.log(`Vault Address:  ${addresses.vault}`);
    console.log();
    console.log(kleur.dim('To deposit:'));
    console.log(kleur.dim('1. Approve token spending on the vault contract'));
    console.log(kleur.dim('2. Call vault.deposit() with your account ID and amount'));
    console.log();
    console.log(kleur.yellow('Note: Direct deposit requires wallet interaction.'));
    console.log(kleur.yellow('Use a web3 wallet or ethers.js to execute the deposit transaction.'));
  } catch (error) {
    if (error instanceof Error) {
      console.log(kleur.red(error.message));
    }
  }
}

export async function withdraw(
  token: string,
  amount: string,
  receiver: string,
  chainId: number,
  brokerId: string,
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

  if (!isSupportedChain(chainId, network)) {
    console.log(kleur.red(`Chain ID ${chainId} is not supported on ${network}`));
    return;
  }

  console.log(kleur.cyan(`\n💸 Withdraw ${amount} ${token} to ${receiver}\n`));

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const nonceResponse = await client.get<{ success: boolean; data?: { withdraw_nonce: string } }>(
      '/v1/withdraw_nonce'
    );

    if (!nonceResponse.success || !nonceResponse.data?.withdraw_nonce) {
      console.log(kleur.red('Failed to get withdrawal nonce'));
      return;
    }

    const withdrawNonce = nonceResponse.data.withdraw_nonce;
    const timestamp = Date.now();

    const message = {
      brokerId,
      chainId,
      receiver,
      token: token.toUpperCase(),
      amount,
      withdrawNonce,
      timestamp,
    };

    console.log(kleur.dim('Withdraw request prepared.'));
    console.log(kleur.dim('Message:'), message);
    console.log();
    console.log(kleur.yellow('To complete withdrawal, you need to:'));
    console.log(kleur.yellow('1. Sign this message with your wallet (EIP-712)'));
    console.log(kleur.yellow('2. Submit using: orderly withdraw-submit'));
    console.log();
    console.log(kleur.cyan('EIP-712 Domain:'));
    console.log(
      JSON.stringify(
        {
          ...EIP712_DOMAIN,
          chainId,
          verifyingContract: VERIFYING_CONTRACTS[network],
        },
        null,
        2
      )
    );
    console.log();
    console.log(kleur.cyan('Message Types:'));
    console.log(JSON.stringify(WITHDRAW_TYPES, null, 2));
    console.log();
    console.log(kleur.cyan('Message to sign:'));
    console.log(JSON.stringify(message, null, 2));
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
