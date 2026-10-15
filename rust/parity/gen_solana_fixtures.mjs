// Drives the REAL TypeScript `src/lib/solana.ts` to capture signing vectors.
//
// Usage: node rust/parity/gen_solana_fixtures.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import bs58 from 'bs58';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, 'fixtures');
const tmpDir = path.join(fixturesDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const bundlePath = path.join(tmpDir, 'solana.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'src', 'lib', 'solana.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'error',
});

const mod = await import(bundlePath + '?t=' + Date.now());

const sk = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const privateKey = bs58.encode(sk);
const wallet = mod.createSolanaWalletFromPrivateKey(privateKey, 'testnet');

const registrationNonce = '123456789';
const reg = await mod.signRegistration(wallet, {
  brokerId: 'demo',
  timestamp: 1792047490101,
  registrationNonce,
  network: 'testnet',
});

const addKey = await mod.signAddKey(wallet, {
  brokerId: 'demo',
  publicKey: wallet.address,
  scope: 'read,trading',
  timestamp: 1792047490101,
  expiration: 1892047490101,
  network: 'testnet',
});

const withdraw = await mod.signWithdraw(wallet, {
  brokerId: 'demo',
  chainId: 901901901,
  receiver: wallet.address,
  token: 'USDC',
  amount: '10500000',
  withdrawNonce: '7',
  timestamp: 1792047490101,
});

const settle = await mod.signSettlePnl(wallet, {
  brokerId: 'demo',
  chainId: 901901901,
  settleNonce: '3',
  timestamp: 1792047490101,
});

const fixture = {
  privateKey,
  address: wallet.address,
  registration: { input: { brokerId: 'demo', timestamp: 1792047490101, registrationNonce }, ...reg },
  addKey: { input: { brokerId: 'demo', scope: 'read,trading', timestamp: 1792047490101, expiration: 1892047490101 }, ...addKey },
  withdraw: { input: { chainId: 901901901, token: 'USDC', amount: '10500000', withdrawNonce: '7', timestamp: 1792047490101 }, ...withdraw },
  settlePnl: { input: { brokerId: 'demo', chainId: 901901901, settleNonce: '3', timestamp: 1792047490101 }, ...settle },
  validation: {
    valid: mod.isValidSolanaAddress(wallet.address),
    invalid: mod.isValidSolanaAddress('nope'),
  },
};

fs.writeFileSync(path.join(fixturesDir, 'solana.json'), JSON.stringify(fixture, null, 2) + '\n');
console.log('address', wallet.address);
console.log('registration sig', reg.signature);
console.log('withdraw sig', withdraw.signature);
