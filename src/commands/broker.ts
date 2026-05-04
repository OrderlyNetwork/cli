import kleur from 'kleur';
import prompts from 'prompts';
import { DexApiClient } from '../lib/dex-api.js';
import { OrderlyClient } from '../lib/api.js';
import { listWalletKeys, getWalletKey } from '../lib/keychain.js';
import { createWalletFromPrivateKey, normalizePrivateKey, signRegistration } from '../lib/evm.js';
import { output, error, handleError, type OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

const BROKER_ID_REGEX = /^[a-z0-9_-]+$/;

const SUPPORTED_CHAINS: Record<string, { name: string; chainId: number }> = {
  ethereum: { name: 'Ethereum', chainId: 1 },
  arbitrum: { name: 'Arbitrum', chainId: 42161 },
  base: { name: 'Base', chainId: 8453 },
};

const TESTNET_CHAINS: Record<string, { name: string; chainId: number }> = {
  sepolia: { name: 'Sepolia', chainId: 11155111 },
  'arbitrum-sepolia': { name: 'Arbitrum Sepolia', chainId: 421614 },
  'base-sepolia': { name: 'Base Sepolia', chainId: 84532 },
};

type PaymentType = 'usdc' | 'usdt' | 'order';

function validateBrokerId(id: string): string | true {
  if (id.length < 5) return 'Broker ID must be at least 5 characters';
  if (id.length > 15) return 'Broker ID must be at most 15 characters';
  if (!BROKER_ID_REGEX.test(id)) return 'Broker ID can only contain lowercase letters, numbers, hyphens, and underscores';
  if (id.includes('orderly')) return 'Broker ID cannot contain "orderly"';
  return true;
}

function validateFee(value: string, min: number, max: number, label: string): string | true {
  const num = parseFloat(value);
  if (isNaN(num)) return `${label} must be a number`;
  if (num < min || num > max) return `${label} must be between ${min} and ${max}`;
  const decimals = value.includes('.') ? value.split('.')[1].length : 0;
  if (decimals > 1) return `${label} must be in 0.1 bps increments`;
  return true;
}

async function fetchExistingBrokerIds(network: Network): Promise<string[]> {
  const client = new OrderlyClient(network);
  try {
    const result = (await client.get<{
      data?: { rows?: Array<{ broker_id: string }> };
    }>('/v1/public/broker/name', false)) as {
      data?: { rows?: Array<{ broker_id: string }> };
    };
    return result?.data?.rows?.map((r) => r.broker_id) ?? [];
  } catch {
    return [];
  }
}

async function selectEvmWallet(network: Network): Promise<string> {
  const wallets = await listWalletKeys();
  const evmWallets = wallets.filter((w) => w.network === network && w.walletType === 'EVM');

  if (evmWallets.length === 0) {
    error('No EVM wallets found. Import one first with `orderly wallet-import --type EVM`.');
  }

  if (evmWallets.length === 1) {
    return evmWallets[0].address;
  }

  const response = await prompts({
    type: 'select',
    name: 'address',
    message: 'Select EVM wallet to authenticate with',
    choices: evmWallets.map((w) => ({
      title: `${w.address} (${w.walletType})`,
      value: w.address,
    })),
  });

  if (!response.address) {
    error('Cancelled.');
  }

  return response.address;
}



async function registerAndFinalize(
  walletAddress: string,
  brokerId: string,
  dexClient: DexApiClient,
  orderlyClient: OrderlyClient,
  network: Network
): Promise<void> {
  const chainId = network === 'mainnet' ? 42161 : 421614;

  const existing = await orderlyClient.getAccount(walletAddress, brokerId, 'EVM');
  if (!existing.success || !existing.data?.account_id) {
    console.log(kleur.dim('Registering wallet with Orderly...'));

    const nonceRes = await orderlyClient.getRegistrationNonce();
    if (!nonceRes.success || !nonceRes.data?.registration_nonce) {
      error('Failed to get registration nonce');
    }
    const nonce = nonceRes.data.registration_nonce;
    const timestamp = Date.now();

    const walletKey = await getWalletKey(walletAddress, network);
    if (!walletKey) error('Wallet key not found');
    const evmWallet = createWalletFromPrivateKey(normalizePrivateKey(walletKey.privateKey));

    const signature = await signRegistration(evmWallet, {
      brokerId,
      chainId,
      timestamp: String(timestamp),
      registrationNonce: nonce,
    });

    const registerRes = await orderlyClient.registerAccount(
      { brokerId, chainId, timestamp: String(timestamp), registrationNonce: nonce },
      signature,
      walletAddress,
    );
    if (!registerRes.success || !registerRes.data?.account_id) {
      error('Failed to register account with Orderly');
    }
    console.log(kleur.dim(`  Account ID: ${registerRes.data.account_id}`));
  }

  console.log(kleur.dim('Finalizing admin wallet...'));
  const finalizeRes = await dexClient.finalizeAdminWallet();
  if (finalizeRes.success) {
    console.log(kleur.green('✅ Admin wallet finalized. DEX is now graduated!'));
  } else {
    console.log(kleur.yellow(`⚠️  Finalization returned: ${finalizeRes.message}`));
  }
}

export async function brokerCreate(
  brokerId: string | undefined,
  address: string | undefined,
  txHash: string | undefined,
  chain: string | undefined,
  chainId: number | undefined,
  paymentType: PaymentType | undefined,
  makerFee: number | undefined,
  takerFee: number | undefined,
  rwaMakerFee: number | undefined,
  rwaTakerFee: number | undefined,
  network: Network,
  format: OutputFormat
): Promise<void> {
  const isDirect = !!txHash;

  if (!isDirect) {
    console.log(kleur.cyan(`\n🏗️  Create Broker ID (${network})\n`));
  }

  let walletAddress = address;
  if (!walletAddress) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      error('--address is required in non-interactive mode.', [
        'Example: orderly broker-create my-broker --address 0x1234...',
      ]);
    }
    walletAddress = await selectEvmWallet(network);
  }

  const dexClient = new DexApiClient(network);

  if (!isDirect) {
    console.log(kleur.dim('Authenticating with Orderly One...'));
  }

  try {
    await dexClient.authenticate(walletAddress);
  } catch (err) {
    handleError(err);
  }

  if (!isDirect) {
    console.log(kleur.green('Authenticated.'));

    console.log(kleur.dim('Checking DEX status...'));
    const dexStatus = await dexClient.getDex();
    if (!dexStatus.exists) {
      console.log(kleur.dim('No DEX found. Creating custom integration DEX...'));
      try {
        await dexClient.createCustomDex();
        console.log(kleur.green('Custom DEX created.'));
      } catch (err) {
        handleError(err);
      }
    } else {
      if (dexStatus.integrationType === 'custom') {
        console.log(kleur.dim('Existing custom DEX found.'));
      } else {
        console.log(kleur.dim('Existing DEX found.'));
      }
    }

    console.log();
  }

  if (isDirect) {
    if (!brokerId) error('--broker-id is required with --tx-hash in non-interactive mode.');
    if (!chain) error('--chain is required with --tx-hash.');
    if (!chainId) error('--chain-id is required with --tx-hash.');
    if (!paymentType) error('--payment-type is required with --tx-hash.');
    if (makerFee === undefined) error('--maker-fee is required with --tx-hash.');
    if (takerFee === undefined) error('--taker-fee is required with --tx-hash.');
    if (rwaMakerFee === undefined) error('--rwa-maker-fee is required with --tx-hash.');
    if (rwaTakerFee === undefined) error('--rwa-taker-fee is required with --tx-hash.');

    const feeError = (v: number, min: number, max: number, label: string) => {
      if (v < min || v > max) return `${label} must be between ${min} and ${max} (got ${v})`;
      return null;
    };
    const feeErr = feeError(makerFee!, -0.5, 15, '--maker-fee')
      ?? feeError(takerFee!, 3, 15, '--taker-fee')
      ?? feeError(rwaMakerFee!, -0.5, 15, '--rwa-maker-fee')
      ?? feeError(rwaTakerFee!, 5, 15, '--rwa-taker-fee');
    if (feeErr) error(feeErr);

    const dexStatus = await dexClient.getDex();
    if (!dexStatus.exists) {
      try {
        await dexClient.createCustomDex();
      } catch (err) {
        handleError(err);
      }
    }

    try {
      const result = await dexClient.verifyTx({
        txHash: txHash!,
        chain: chain!,
        chainId: chainId!,
        chain_type: 'EVM',
        brokerId: brokerId!,
        makerFee: makerFee!,
        takerFee: takerFee!,
        rwaMakerFee: rwaMakerFee!,
        rwaTakerFee: rwaTakerFee!,
        paymentType: paymentType!,
      });
      if (result.success) {
        const orderlyClient = new OrderlyClient(network);
        await registerAndFinalize(walletAddress, brokerId!, dexClient, orderlyClient, network);
        console.log();
      }
      output(result, format);
    } catch (err) {
      handleError(err);
    }
    return;
  }

  let feeOptions;
  try {
    feeOptions = await dexClient.getFeeOptions();
  } catch (err) {
    handleError(err);
  }

  console.log(kleur.bold('Payment Options:'));
  console.log(
    kleur.dim('  USDC:  ') + kleur.white(`${feeOptions!.usdc.amount} USDC`)
  );
  console.log(
    kleur.dim('  USDT:  ') + kleur.white(`${feeOptions!.usdt.amount} USDT`)
  );
  if (feeOptions!.order.currentPrice) {
    const orderAmt = feeOptions!.order.amount;
    console.log(
      kleur.dim('  ORDER: ') +
        kleur.white(`${orderAmt.toFixed(2)} ORDER`) +
        kleur.dim(` (price: $${feeOptions!.order.currentPrice.toFixed(4)} per ORDER)`)
    );
  }
  console.log();
  console.log(kleur.dim('  Receiver: ') + kleur.cyan(feeOptions!.receiverAddress));
  console.log();

  console.log(kleur.dim('Checking existing broker IDs...'));
  const existingIds = await fetchExistingBrokerIds(network);

  let bId = brokerId;
  if (!bId) {
    const response = await prompts({
      type: 'text',
      name: 'brokerId',
      message: 'Enter your desired broker ID',
      validate: (val: string) => {
        const formatCheck = validateBrokerId(val);
        if (formatCheck !== true) return formatCheck;
        if (existingIds.includes(val)) return 'This broker ID is already taken';
        return true;
      },
    });
    if (!response.brokerId) error('Cancelled.');
    bId = response.brokerId.trim().toLowerCase();
  } else {
    bId = bId.toLowerCase();
    const formatCheck = validateBrokerId(bId);
    if (formatCheck !== true) error(formatCheck);
    if (existingIds.includes(bId)) error(`Broker ID "${bId}" is already taken.`);
  }

  console.log();

  let fees: { makerFee: number; takerFee: number; rwaMakerFee: number; rwaTakerFee: number };

  if (
    makerFee !== undefined &&
    takerFee !== undefined &&
    rwaMakerFee !== undefined &&
    rwaTakerFee !== undefined
  ) {
    fees = { makerFee, takerFee, rwaMakerFee, rwaTakerFee };
  } else {
    console.log(kleur.bold('Set Fee Rates (basis points):'));
    console.log(kleur.dim('  Maker fee range: -0.5 to 15'));
    console.log(kleur.dim('  Taker fee range: 3 to 15'));
    console.log(kleur.dim('  RWA maker fee range: -0.5 to 15'));
    console.log(kleur.dim('  RWA taker fee range: 5 to 15'));
    console.log();

    const feeResponse = await prompts([
      {
        type: 'number',
        name: 'makerFee',
        message: 'Maker fee (bps)',
        initial: 0,
        validate: (v: string) => validateFee(String(v), -0.5, 15, 'Maker fee'),
      },
      {
        type: 'number',
        name: 'takerFee',
        message: 'Taker fee (bps)',
        initial: 3,
        validate: (v: string) => validateFee(String(v), 3, 15, 'Taker fee'),
      },
      {
        type: 'number',
        name: 'rwaMakerFee',
        message: 'RWA maker fee (bps)',
        initial: 0,
        validate: (v: string) => validateFee(String(v), -0.5, 15, 'RWA maker fee'),
      },
      {
        type: 'number',
        name: 'rwaTakerFee',
        message: 'RWA taker fee (bps)',
        initial: 5,
        validate: (v: string) => validateFee(String(v), 5, 15, 'RWA taker fee'),
      },
    ]);

    if (
      feeResponse.makerFee === undefined ||
      feeResponse.takerFee === undefined ||
      feeResponse.rwaMakerFee === undefined ||
      feeResponse.rwaTakerFee === undefined
    ) {
      error('Cancelled.');
    }

    fees = feeResponse;
  }

  console.log();

  const chains = network === 'mainnet' ? SUPPORTED_CHAINS : TESTNET_CHAINS;

  let selectedChain = chain;
  let selectedChainId = chainId;

  if (!selectedChain) {
    const chainChoices = Object.entries(chains).map(([key, val]) => ({
      title: `${val.name} (${val.chainId})`,
      value: key,
    }));

    const chainResponse = await prompts({
      type: 'select',
      name: 'chain',
      message: 'Select payment chain',
      choices: chainChoices,
    });
    if (!chainResponse.chain) error('Cancelled.');
    selectedChain = chainResponse.chain;
    selectedChainId = chains[selectedChain!]!.chainId;
  } else if (!selectedChainId) {
    const chainInfo = chains[selectedChain];
    if (!chainInfo) {
      error(
        `Unknown chain "${selectedChain}". Valid: ${Object.keys(chains).join(', ')}`
      );
    }
    selectedChainId = chainInfo.chainId;
  }

  let pType = paymentType;
  if (!pType) {
    const pTypeResponse = await prompts({
      type: 'select',
      name: 'paymentType',
      message: 'Select payment token',
      choices: [
        { title: 'USDC', value: 'usdc' },
        { title: 'USDT', value: 'usdt' },
        { title: 'ORDER', value: 'order' },
      ],
    });
    if (!pTypeResponse.paymentType) error('Cancelled.');
    pType = pTypeResponse.paymentType;
  }

  console.log();
  console.log(kleur.bold('━━━ Payment Instructions ━━━'));
  console.log();
  console.log(kleur.dim('  Send exactly: ') + kleur.white(`${feeOptions![pType!]!.amount} ${pType!.toUpperCase()}`));
  console.log(kleur.dim('  To address:   ') + kleur.cyan(feeOptions!.receiverAddress));
  console.log(kleur.dim('  On chain:     ') + kleur.white(`${selectedChain} (${selectedChainId})`));
  console.log();
  console.log(kleur.yellow('⚠️  Send the exact amount. After the transaction is confirmed, enter the tx hash below.'));
  console.log();

  const txResponse = await prompts({
    type: 'text',
    name: 'txHash',
    message: 'Enter payment transaction hash',
    validate: (v: string) => (v.length >= 10 ? true : 'Transaction hash is required'),
  });
  if (!txResponse.txHash) error('Cancelled.');

  console.log();
  console.log(kleur.dim('Verifying payment and creating broker ID...'));

  try {
    const result = await dexClient.verifyTx({
      txHash: txResponse.txHash,
      chain: selectedChain!,
      chainId: selectedChainId!,
      chain_type: 'EVM',
      brokerId: bId!,
      makerFee: fees.makerFee,
      takerFee: fees.takerFee,
      rwaMakerFee: fees.rwaMakerFee,
      rwaTakerFee: fees.rwaTakerFee,
      paymentType: pType!,
    });

    if (result.success) {
      console.log();
      console.log(kleur.green('✅ Broker ID created successfully!'));
      console.log(kleur.dim(`  Broker ID: ${result.brokerCreationData?.brokerId ?? bId}`));
      if (result.brokerCreationData?.transactionHashes) {
        const hashes = result.brokerCreationData.transactionHashes;
        for (const [label, hash] of Object.entries(hashes)) {
          console.log(kleur.dim(`  ${label}: ${hash}`));
        }
      }
      console.log();

      const orderlyClient = new OrderlyClient(network);
      await registerAndFinalize(walletAddress, bId!, dexClient, orderlyClient, network);
      console.log();
      output(result, format);
    } else {
      output(result, format);
    }
  } catch (err) {
    handleError(err);
  }
}

export async function brokerStatus(
  address: string | undefined,
  network: Network,
  format: OutputFormat
): Promise<void> {
  let walletAddress = address;
  if (!walletAddress) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      error('--address is required in non-interactive mode.', [
        'Example: orderly broker-status --address 0x1234...',
      ]);
    }
    walletAddress = await selectEvmWallet(network);
  }

  const dexClient = new DexApiClient(network);

  try {
    await dexClient.authenticate(walletAddress);
  } catch (err) {
    handleError(err);
  }

  const dex = await dexClient.getDex();

  if (!dex.exists) {
    output({ exists: false, message: 'No DEX found for this wallet. Run `orderly broker-create` to get started.' }, format);
    return;
  }

  output({
    exists: true,
    brokerId: dex.brokerId,
    brokerName: dex.brokerName,
    integrationType: dex.integrationType,
    isGraduated: dex.isGraduated,
    repoUrl: dex.repoUrl,
  }, format);
}
