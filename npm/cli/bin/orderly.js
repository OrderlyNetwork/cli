#!/usr/bin/env node
// Launcher for the native Orderly CLI.
//
// npm installs this package plus one platform package (os/cpu filtered). This
// script replaces itself with that binary, inheriting stdio so TTY prompts,
// colours and exit codes behave exactly as with a direct install.
import { spawn } from 'node:child_process';
import { resolveBinary } from '../lib/resolve.js';

let binary;
try {
  binary = resolveBinary();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

const child = spawn(binary, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  process.stderr.write(`orderly: failed to start ${binary}: ${error.message}\n`);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
