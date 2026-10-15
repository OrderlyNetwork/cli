// Records the exact `orderly --help` output from the TypeScript CLI, so the
// Rust port's help text can be diffed offline.
//
// Usage: node rust/parity/gen_help_fixture.mjs
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixturesDir = path.join(here, 'fixtures');
fs.mkdirSync(fixturesDir, { recursive: true });

const out = execFileSync('node', [path.join(repoRoot, 'dist', 'index.js'), '--help'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

fs.writeFileSync(path.join(fixturesDir, 'help.txt'), out);
console.log(`wrote ${out.split('\n').length} lines to rust/parity/fixtures/help.txt`);
