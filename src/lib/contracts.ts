import { Network } from '../types.js';

interface ContractAddresses {
  name: string;
  vault: string;
  usdc: string;
  usdt?: string;
  verifyingContract: string;
}

const CONTRACTS: Record<number, ContractAddresses> = {
  1: {
    name: 'ethereum',
    vault: '0x111d26Fb58B565Ec37EEb7E4485f531A6076C5ec33d9F19d',
    usdc: '0xA0b86991cC6d8eB81945A0DD6e048b9eE7C6E5f5b8',
    verifyingContract: '0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203',
  },
  10: {
    name: 'optimism',
    vault: '0x94C19B73f29f78Af78E6Ba37FfCd45Db8f65Ae8dD3c95aD5CDCd2f',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    verifyingContract: '0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203',
  },
  8453: {
    name: 'base',
    vault: '0x93159c0C05262B98E87A11D6D8DfD8F1e6Fb7E4485f531A6076C5ec33d9F19d',
    usdc: '0x833589f0069DD751FA32eb76C5E634bD712Bc71e84',
    verifyingContract: '0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203',
  },
  42161: {
    name: 'arbitrum',
    vault: '0x816f722424B49Cf1275cc86DA9840Fbd5a6167e9',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    verifyingContract: '0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203',
  },
  421614: {
    name: 'arbitrum-sepolia',
    vault: '0x0EaC556c0C2321BA25b9DC01e4e3c95aD5CDCd2f',
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    usdt: '0xEf54C221Fc94517877F0F40eCd71E0A3866D66C2',
    verifyingContract: '0x1826B75e2ef249173FC735149AE4B8e9ea10abff',
  },
  84532: {
    name: 'base-sepolia',
    vault: '0x5B0945b67BAe1F7Ee9700Df1a4F3e395B89D2e549',
    usdc: '0xf7DBA6d07790a8d22cC4B88D6BE1c6f3adC5B4f82e',
    verifyingContract: '0x1826B75e2ef249173FC735149AE4B8e9ea10abff',
  },
  11155111: {
    name: 'ethereum-sepolia',
    vault: '0x23a0D7BEd78D41Bbb8307FEd590BEb19Db4b61F0B7fF73',
    usdc: '0x1c7D4B732Aa88D4c4049C58254DEB8Cb9d95bC1d',
    verifyingContract: '0x1826B75e2ef249173FC735149AE4B8e9ea10abff',
  },
  5000: {
    name: 'mantle',
    vault: '0x9DC03987De8d05EC7C41B39F9f04170Ccd03D1',
    usdc: '0x1BCaA7E732a82d7873144C7d91a50DC05C2C4bE',
    verifyingContract: '0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203',
  },
  1329: {
    name: 'sei',
    vault: '0x7C19B73f29f78Af78E6Ba37FfCd45Db8f65Ae8dD3c95aD5CDCd2f',
    usdc: '0x38921F4078B77P42891cF41f08B02',
    verifyingContract: '0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203',
  },
};

export function getContractAddresses(chainId: number, network: Network): ContractAddresses {
  const isTestnet = network === 'testnet';
  if (isTestnet) {
    switch (chainId) {
      case 421614:
        return CONTRACTS[421614];
      case 84532:
        return CONTRACTS[84532];
      case 11155111:
        return CONTRACTS[11155111];
      default:
        throw new Error(`Unsupported testnet chain: ${chainId}`);
    }
  } else {
    switch (chainId) {
      case 1:
        return CONTRACTS[1];
      case 10:
        return CONTRACTS[10];
      case 8453:
        return CONTRACTS[8453];
      case 42161:
        return CONTRACTS[42161];
      case 5000:
        return CONTRACTS[5000];
      case 1329:
        return CONTRACTS[1329];
      default:
        throw new Error(`Unsupported mainnet chain: ${chainId}`);
    }
  }
}

export function getChainName(chainId: number): string {
  const contract = CONTRACTS[chainId];
  return contract?.name || `Chain ${chainId}`;
}

export function isSupportedChain(chainId: number, network: Network): boolean {
  try {
    getContractAddresses(chainId, network);
    return true;
  } catch {
    return false;
  }
}
