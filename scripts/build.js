#!/usr/bin/env node

import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev');

console.log(`Building Orderly CLI${isWatch ? ' (watch mode)' : ''}...\n`);

const distDir = path.join(projectRoot, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const nodeBuiltins = [
  'path',
  'fs',
  'url',
  'util',
  'stream',
  'http',
  'https',
  'net',
  'os',
  'crypto',
  'events',
  'buffer',
  'string_decoder',
  'querystring',
  'zlib',
  'tls',
  'dgram',
  'dns',
  'cluster',
  'module',
  'vm',
  'child_process',
  'worker_threads',
  'perf_hooks',
  'async_hooks',
  'timers',
  'timers/promises',
  'readline',
  'repl',
  'domain',
  'constants',
  'process',
  'v8',
  'inspector',
  'trace_events',
];

const externalDeps = [
  'axios',
  'cac',
  'kleur',
  'keytar',
  'ora',
  'prompts',
  'zod',
  '@noble/curves',
  'ethers',
  'bs58',
];

const buildConfig = {
  entryPoints: [path.join(projectRoot, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(distDir, 'index.js'),
  minify: !isDev,
  sourcemap: true,
  external: [...nodeBuiltins, ...externalDeps],
  banner: {
    js: '#!/usr/bin/env node\n',
  },
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
  },
};

async function build() {
  try {
    if (isWatch) {
      const ctx = await esbuild.context(buildConfig);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      await esbuild.build(buildConfig);

      let content = fs.readFileSync(buildConfig.outfile, 'utf-8');
      if (content.startsWith('#!/usr/bin/env node\n#!/usr/bin/env node')) {
        content = content.replace(
          '#!/usr/bin/env node\n#!/usr/bin/env node',
          '#!/usr/bin/env node'
        );
        fs.writeFileSync(buildConfig.outfile, content);
      }

      fs.chmodSync(buildConfig.outfile, '755');

      console.log('\nBuild complete!');
      const stats = fs.statSync(buildConfig.outfile);
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(`  Output: ${buildConfig.outfile}`);
      console.log(`  Size: ${sizeKB} KB`);
      console.log('\nRun with: node dist/index.js --help');
    }
  } catch (error) {
    console.error('Build failed:', error);
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

build();
