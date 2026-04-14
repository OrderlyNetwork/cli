import axios from 'axios';
import { Network } from '../types.js';
import { getApiBaseUrl } from './config.js';

export const VERIFYING_CONTRACTS: Record<Network, string> = {
  mainnet: '0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203',
  testnet: '0x1826B75e2ef249173FC735149AE4B8e9ea10abff',
};

interface ChainInfo {
  name: string;
  chain_id: number | string;
  vault_address: string;
  public_rpc_url?: string;
  currency_symbol?: string;
  currency_decimal?: number;
  explorer_base_url?: string;
  broker_ids?: string[];
}

interface TokenInfo {
  token: string;
  decimals: number;
  chain_details: Array<{
    chain_id: number | string;
    contract_address: string;
    decimals: number;
    withdrawal_fee: number;
    cross_chain_withdrawal_fee: number;
    display_name: string;
  }>;
}

const chainCache = new Map<Network, ChainInfo[]>();
const tokenCache = new Map<Network, TokenInfo[]>();

async function fetchChainInfo(network: Network): Promise<ChainInfo[]> {
  if (chainCache.has(network)) {
    return chainCache.get(network)!;
  }
  const baseUrl = getApiBaseUrl(network);
  const response = await axios.get(`${baseUrl}/v1/public/chain_info`);
  const rows = response.data?.data?.rows ?? response.data?.rows ?? [];
  chainCache.set(network, rows);
  return rows;
}

async function fetchTokenInfo(network: Network): Promise<TokenInfo[]> {
  if (tokenCache.has(network)) {
    return tokenCache.get(network)!;
  }
  const baseUrl = getApiBaseUrl(network);
  const response = await axios.get(`${baseUrl}/v1/public/token`);
  const rows = response.data?.data?.rows ?? response.data?.rows ?? [];
  tokenCache.set(network, rows);
  return rows;
}

export async function getChainInfo(chainId: number, network: Network): Promise<ChainInfo | null> {
  const chains = await fetchChainInfo(network);
  return chains.find((c) => Number(c.chain_id) === chainId) ?? null;
}

export async function getChainName(chainId: number, network: Network): Promise<string> {
  const chain = await getChainInfo(chainId, network);
  return chain?.name ?? `Chain ${chainId}`;
}

export async function getChainVaultAddress(
  chainId: number,
  network: Network
): Promise<string | null> {
  const chain = await getChainInfo(chainId, network);
  return chain?.vault_address ?? null;
}

export async function getTokenAddress(
  token: string,
  chainId: number,
  network: Network
): Promise<string | null> {
  const tokens = await fetchTokenInfo(network);
  const tokenInfo = tokens.find((t) => t.token === token.toUpperCase());
  if (!tokenInfo) return null;
  const chainDetail = tokenInfo.chain_details.find((c) => String(c.chain_id) === String(chainId));
  return chainDetail?.contract_address ?? null;
}

export async function getTokenDecimals(
  token: string,
  chainId: number,
  network: Network
): Promise<number | null> {
  const tokens = await fetchTokenInfo(network);
  const tokenInfo = tokens.find((t) => t.token === token.toUpperCase());
  if (!tokenInfo) return null;
  const chainDetail = tokenInfo.chain_details.find((c) => String(c.chain_id) === String(chainId));
  return chainDetail?.decimals ?? tokenInfo.decimals ?? null;
}

export async function isSupportedChain(chainId: number, network: Network): Promise<boolean> {
  const chain = await getChainInfo(chainId, network);
  return chain !== null;
}

export async function getWithdrawalFee(
  token: string,
  chainId: number,
  network: Network
): Promise<{ fee: number; crossChainFee: number } | null> {
  const tokens = await fetchTokenInfo(network);
  const tokenInfo = tokens.find((t) => t.token === token.toUpperCase());
  if (!tokenInfo) return null;
  const chainDetail = tokenInfo.chain_details.find((c) => String(c.chain_id) === String(chainId));
  if (!chainDetail) return null;
  return { fee: chainDetail.withdrawal_fee, crossChainFee: chainDetail.cross_chain_withdrawal_fee };
}

export function getVerifyingContract(network: Network): string {
  return VERIFYING_CONTRACTS[network];
}
