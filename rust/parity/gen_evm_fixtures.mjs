// Drives the REAL TypeScript `src/lib/evm.ts` (ethers) to capture EIP-712 /
// personal-sign vectors, so the Rust port can be diffed offline.
//
// Usage: node rust/parity/gen_evm_fixtures.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, 'fixtures');
const tmpDir = path.join(fixturesDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const bundlePath = path.join(tmpDir, 'evm.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'src', 'lib', 'evm.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'error',
});

const mod = await import(bundlePath + '?t=' + Date.now());

const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const wallet = mod.createWalletFromPrivateKey(privateKey);

const registration = {
  brokerId: 'demo',
  chainId: 421614,
  timestamp: '1792047490101',
  registrationNonce: '123456789',
};
const addKey = {
  brokerId: 'demo',
  chainId: 421614,
  orderlyKey: 'ed25519:FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF',
  scope: 'read,trading',
  timestamp: 1792047490101,
  expiration: 1892047490101,
};
const withdraw = {
  brokerId: 'demo',
  chainId: 421614,
  receiver: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  token: 'USDC',
  amount: '10500000',
  withdrawNonce: '7',
  timestamp: 1792047490101,
};
const settle = {
  brokerId: 'demo',
  chainId: 421614,
  settleNonce: '3',
  timestamp: 1792047490101,
};
const withdrawMainnet = { ...withdraw, chainId: 42161 };

const fixture = {
  privateKey,
  address: wallet.address,
  personalSign: {
    message: 'hello orderly',
    signature: await wallet.signMessage('hello orderly'),
  },
  registration: {
    message: registration,
    hash: mod.getRegistrationHash(registration),
    signature: await mod.signRegistration(wallet, registration),
  },
  addKey: {
    message: addKey,
    hash: mod.getAddKeyHash(addKey),
    signature: await mod.signAddKey(wallet, addKey),
  },
  withdrawTestnet: {
    message: withdraw,
    signature: await mod.signWithdraw(wallet, withdraw, 'testnet'),
  },
  withdrawMainnet: {
    message: withdrawMainnet,
    signature: await mod.signWithdraw(wallet, withdrawMainnet, 'mainnet'),
  },
  settlePnlTestnet: {
    message: settle,
    signature: await mod.signSettlePnl(wallet, settle, 'testnet'),
  },
  validation: {
    validAddress: mod.isValidEVMAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'),
    invalidAddress: mod.isValidEVMAddress('0x123'),
    validKey: mod.isValidPrivateKey(privateKey),
    invalidKey: mod.isValidPrivateKey('abc'),
    normalized: mod.normalizePrivateKey('abcdef'),
  },
};

fs.writeFileSync(path.join(fixturesDir, 'evm.json'), JSON.stringify(fixture, null, 2) + '\n');
console.log('address', fixture.address);
console.log('registration sig', fixture.registration.signature);
console.log('addKey sig', fixture.addKey.signature);
