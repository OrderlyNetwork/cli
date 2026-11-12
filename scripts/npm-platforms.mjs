#!/usr/bin/env node
// Pack the released binaries as one npm package per target.
//
// The trading MCP (and any other npm consumer) depends on these through
// optionalDependencies + os/cpu, so `npm i` installs exactly one copy of the
// CLI and never needs a separate install step.
//
// Usage (after the release archives have been extracted):
//   node scripts/npm-platforms.mjs --binaries dist/binaries --out npm-platforms
//
// `--binaries` holds one directory per Rust target containing the executable:
//   <binaries>/x86_64-unknown-linux-musl/orderly
//   <binaries>/x86_64-pc-windows-msvc/orderly.exe

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TARGETS = [
  { target: 'x86_64-unknown-linux-musl', os: 'linux', cpu: 'x64' },
  { target: 'aarch64-unknown-linux-musl', os: 'linux', cpu: 'arm64' },
  { target: 'x86_64-apple-darwin', os: 'darwin', cpu: 'x64' },
  { target: 'aarch64-apple-darwin', os: 'darwin', cpu: 'arm64' },
  { target: 'x86_64-pc-windows-msvc', os: 'win32', cpu: 'x64' },
  { target: 'aarch64-pc-windows-msvc', os: 'win32', cpu: 'arm64' },
];

export const PACKAGE_SCOPE = '@orderly.network';

/** Name of the executable inside the archive for a target. */
export function binaryName(target) {
  return target.includes('windows') ? 'orderly.exe' : 'orderly';
}

/** npm package that carries the binary for a Rust target triple. */
export function packageName(target) {
  const entry = TARGETS.find((candidate) => candidate.target === target);
  if (!entry) throw new Error(`unknown target: ${target}`);
  return `${PACKAGE_SCOPE}/cli-${entry.os}-${entry.cpu}`;
}

/** The target triple built for the host running this script, if any. */
export function hostTarget(platform = process.platform, arch = process.arch) {
  const entry = TARGETS.find(
    (candidate) =>
      candidate.os === platform &&
      candidate.cpu === (arch === 'arm64' ? 'arm64' : 'x64')
  );
  return entry ? entry.target : null;
}

export function crateVersion(cargoToml = path.join(REPO_ROOT, 'Cargo.toml')) {
  const version = readFileSync(cargoToml, 'utf8').match(/^version = "(.*)"/m);
  if (!version) throw new Error(`no version in ${cargoToml}`);
  return version[1];
}

export function platformPackageJson(entry, version) {
  return {
    name: packageName(entry.target),
    version,
    description: `Orderly Network CLI binary for ${entry.os}-${entry.cpu}`,
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'git+https://gitlab.com/orderlynetwork/orderly-fe/cli.git',
    },
    homepage: 'https://github.com/OrderlyNetwork/cli',
    os: [entry.os],
    cpu: [entry.cpu],
    files: ['bin', 'LICENSE'],
    // Binaries are platform-specific; never run install scripts.
    scripts: undefined,
  };
}

/**
 * Copy one binary per target into its own package directory.
 * Returns the package directories that were written.
 */
export function packPlatforms({ binariesDir, outDir, version, targets = TARGETS }) {
  if (!/^\d+\.\d+\.\d+/.test(version ?? '')) {
    throw new Error(`invalid version: ${version}`);
  }

  const written = [];
  for (const entry of targets) {
    const source = path.join(binariesDir, entry.target, binaryName(entry.target));
    if (!existsSync(source)) {
      throw new Error(`missing binary for ${entry.target}: ${source}`);
    }
    const dir = path.join(outDir, packageName(entry.target));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(path.join(dir, 'bin'), { recursive: true });
    const destination = path.join(dir, 'bin', binaryName(entry.target));
    copyFileSync(source, destination);
    if (!entry.target.includes('windows')) chmodSync(destination, 0o755);

    const license = path.join(REPO_ROOT, 'LICENSE');
    if (existsSync(license)) copyFileSync(license, path.join(dir, 'LICENSE'));

    const manifest = platformPackageJson(entry, version);
    writeFileSync(
      path.join(dir, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    written.push(dir);
  }
  return written;
}

/** Run the packaged host binary once so a broken archive fails the release. */
export function verifyHostBinary(outDir, version, platform = process.platform, arch = process.arch) {
  const target = hostTarget(platform, arch);
  if (!target) return { verified: false, reason: 'no host target in the matrix' };
  const bin = path.join(outDir, packageName(target), 'bin', binaryName(target));
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20_000 });
  if (result.error) throw new Error(`cannot run ${bin}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${bin} --version exited ${result.status}: ${result.stderr}`);
  }
  if (!result.stdout.includes(version)) {
    throw new Error(`${bin} reports ${JSON.stringify(result.stdout.trim())}, expected ${version}`);
  }
  return { verified: true, target };
}

function parseArgs(argv) {
  const args = {
    binariesDir: null,
    outDir: null,
    version: null,
    verifyHost: false,
    printTargets: false,
    targets: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--binaries') args.binariesDir = argv[++index];
    else if (flag === '--out') args.outDir = argv[++index];
    else if (flag === '--version') args.version = argv[++index];
    else if (flag === '--verify-host') args.verifyHost = true;
    else if (flag === '--print-targets') args.printTargets = true;
    else if (flag === '--target') args.targets.push(argv[++index]);
    else throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.printTargets) {
    for (const entry of TARGETS) process.stdout.write(`${entry.target}\n`);
    return;
  }
  if (!args.binariesDir || !args.outDir) {
    throw new Error('usage: npm-platforms.mjs --binaries <dir> --out <dir> [--version X.Y.Z] [--verify-host]');
  }
  const version = args.version ?? crateVersion();
  const selected =
    args.targets.length > 0
      ? TARGETS.filter((entry) => args.targets.includes(entry.target))
      : TARGETS;
  if (selected.length !== (args.targets.length || TARGETS.length)) {
    const known = TARGETS.map((entry) => entry.target).join(', ');
    throw new Error(`unknown --target; expected one of: ${known}`);
  }
  const written = packPlatforms({
    binariesDir: args.binariesDir,
    outDir: args.outDir,
    version,
    targets: selected,
  });
  for (const dir of written) process.stdout.write(`${dir}\n`);
  if (args.verifyHost) {
    const result = verifyHostBinary(args.outDir, version);
    process.stdout.write(
      result.verified
        ? `verified host binary for ${result.target}\n`
        : `skipped host verification: ${result.reason}\n`
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
