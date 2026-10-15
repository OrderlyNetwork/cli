// Drives the REAL TypeScript `src/lib/output.ts` `output()` function and records
// the exact stdout/stderr bytes it produces, so the Rust port can be diffed
// against it offline.
//
// Usage: node rust/parity/gen_output_fixtures.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, 'fixtures');
const tmpDir = path.join(fixturesDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const bundlePath = path.join(tmpDir, 'output.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'src', 'lib', 'output.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  external: ['axios', 'kleur', 'prompts'],
  logLevel: 'error',
});

const mod = await import(bundlePath + '?t=' + Date.now());

const cases = [
  { name: 'envelope_success', format: 'json', data: { success: true, data: { a: 1, b: 'x' } } },
  { name: 'envelope_failure', format: 'json', data: { success: false, code: 1, message: 'no' } },
  { name: 'plain_object', format: 'json', data: { symbol: 'PERP_ETH_USDC', index_price: 2124.82 } },
  { name: 'null_data', format: 'json', data: { data: null } },
  { name: 'rows_objects', format: 'csv', data: { rows: [
      { symbol: 'PERP_ETH_USDC', mark_price: 2124.89 },
      { symbol: 'PERP_BTC_USDC', mark_price: 71551.7 },
    ] } },
  { name: 'rows_empty', format: 'csv', data: { rows: [] } },
  { name: 'rows_null', format: 'csv', data: { rows: null } },
  { name: 'flat_object', format: 'csv', data: { symbol: 'PERP_ETH_USDC', index_price: 2124.82 } },
  { name: 'escaping', format: 'csv', data: { rows: [{ note: 'a,b', q: 'he said "hi"' }] } },
  { name: 'nested_and_arrays', format: 'csv', data: { rows: [{ a: { b: 1 }, list: [{ x: 1 }, { x: 2 }] }] } },
  { name: 'ragged_rows', format: 'csv', data: { rows: [
      { a: { b: 1, c: 2 } },
      { a: { b: 3, c: 4, d: 5 }, extra: 'z' },
    ] } },
  { name: 'scalar_array', format: 'csv', data: { rows: [1, 2, 3] } },
  { name: 'booleans_and_numbers', format: 'csv', data: { rows: [{ ok: true, n: 0.1, big: 1000000 }] } },
  { name: 'list_key', format: 'csv', data: { list: [{ id: 1 }, { id: 2 }] } },
  { name: 'single_array_key', format: 'csv', data: { positions: [{ s: 1 }] } },
  { name: 'top_level_scalar', format: 'csv', data: 42 },
  { name: 'csv_pretty_flag_ignored', format: 'csv', data: { rows: [{ a: 1 }] } },
];

const results = [];
for (const c of cases) {
  const logs = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : String(x))).join(' '));
  console.error = (...a) => errs.push(a.map((x) => (typeof x === 'string' ? x : String(x))).join(' '));
  try {
    mod.output(c.data, c.format);
  } catch (e) {
    logs.push('THREW:' + e.message);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  results.push({
    name: c.name,
    format: c.format,
    data: c.data,
    stdout: logs.join('\n'),
    stderr: errs.join('\n'),
  });
}

fs.writeFileSync(path.join(fixturesDir, 'output.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`wrote ${results.length} fixtures to rust/parity/fixtures/output.json`);
