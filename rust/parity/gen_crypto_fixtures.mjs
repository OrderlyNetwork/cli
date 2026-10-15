// Drives the REAL TypeScript `src/lib/crypto.ts` to capture Ed25519/base58
// vectors, so the Rust port can be diffed offline.
//
// Usage: node rust/parity/gen_crypto_fixtures.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, 'fixtures');
const tmpDir = path.join(fixturesDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const bundlePath = path.join(tmpDir, 'crypto.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'src', 'lib', 'crypto.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'error',
});

const mod = await import(bundlePath + '?t=' + Date.now());

// Deterministic private key: bytes 0..31.
const privateKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');
const publicKey = mod.publicKeyFromPrivateKey(privateKey);

const messages = [
  '',
  'orderly',
  '1792047490101GET/v1/orders',
  '1792047490101POST/v1/order{"symbol":"PERP_ETH_USDC","order_type":"MARKET","side":"BUY","order_quantity":"0.01"}',
  '1792047490101DELETE/v1/order?order_id=123&symbol=PERP_ETH_USDC',
];

const vectors = messages.map((message, i) => {
  const signature = mod.sign(message, privateKey);
  return {
    name: `msg_${i}`,
    privateKey,
    publicKey,
    message,
    signature,
    verifySelf: mod.verify(message, Buffer.from(signature, 'base64url').toString('base64'), publicKey),
  };
});

const b58 = mod.getPublicKeyBase58(publicKey);
const fixture = {
  privateKey,
  publicKey,
  base58: b58,
  base64FromBase58: mod.base58ToBase64(b58),
  vectors,
};

fs.writeFileSync(path.join(fixturesDir, 'crypto.json'), JSON.stringify(fixture, null, 2) + '\n');
console.log(`wrote ${vectors.length} crypto vectors`);
console.log('publicKey', publicKey, 'base58', b58);
