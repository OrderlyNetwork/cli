import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  TARGETS,
  binaryName,
  crateVersion,
  hostTarget,
  packPlatforms,
  packageName,
  platformPackageJson,
  verifyHostBinary,
} from '../npm-platforms.mjs';

function mktemp() {
  return mkdtempSync(path.join(tmpdir(), 'orderly-npm-platforms-'));
}

function fakeBinaries(dir, targets = TARGETS) {
  for (const entry of targets) {
    const targetDir = path.join(dir, entry.target);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, binaryName(entry.target)), '#!/bin/sh\nexit 0\n');
  }
  return dir;
}

test('every target has a unique npm package name', () => {
  const names = TARGETS.map((entry) => packageName(entry.target));
  assert.equal(new Set(names).size, TARGETS.length);
  assert.deepEqual(names, [
    '@orderly.network/cli-linux-x64',
    '@orderly.network/cli-linux-arm64',
    '@orderly.network/cli-darwin-x64',
    '@orderly.network/cli-darwin-arm64',
    '@orderly.network/cli-win32-x64',
    '@orderly.network/cli-win32-arm64',
  ]);
});

test('unknown targets are rejected', () => {
  assert.throws(() => packageName('riscv64-unknown-linux-gnu'), /unknown target/);
});

test('windows packages carry orderly.exe', () => {
  assert.equal(binaryName('x86_64-pc-windows-msvc'), 'orderly.exe');
  assert.equal(binaryName('x86_64-unknown-linux-musl'), 'orderly');
});

test('host target maps from platform and arch', () => {
  assert.equal(hostTarget('linux', 'x64'), 'x86_64-unknown-linux-musl');
  assert.equal(hostTarget('linux', 'arm64'), 'aarch64-unknown-linux-musl');
  assert.equal(hostTarget('darwin', 'arm64'), 'aarch64-apple-darwin');
  assert.equal(hostTarget('win32', 'x64'), 'x86_64-pc-windows-msvc');
  assert.equal(hostTarget('freebsd', 'x64'), null);
});

test('manifest constrains installation with os and cpu', () => {
  const [entry] = TARGETS;
  const manifest = platformPackageJson(entry, '2.2.0');
  assert.equal(manifest.name, '@orderly.network/cli-linux-x64');
  assert.deepEqual(manifest.os, ['linux']);
  assert.deepEqual(manifest.cpu, ['x64']);
  assert.deepEqual(manifest.files, ['bin', 'LICENSE']);
});

test('packPlatforms writes one package per target with an executable binary', () => {
  const root = mktemp();
  const binaries = fakeBinaries(path.join(root, 'binaries'));
  const out = path.join(root, 'out');

  const written = packPlatforms({ binariesDir: binaries, outDir: out, version: '2.2.0' });

  assert.equal(written.length, TARGETS.length);
  for (const entry of TARGETS) {
    const dir = path.join(out, packageName(entry.target));
    const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.equal(manifest.version, '2.2.0');
    assert.equal(manifest.name, packageName(entry.target));

    const bin = path.join(dir, 'bin', binaryName(entry.target));
    assert.ok(statSync(bin).size > 0, `${bin} is empty`);
    if (entry.os !== 'win32') {
      assert.equal(statSync(bin).mode & 0o777, 0o755);
    }
  }
});

test('packPlatforms fails when a binary is missing', () => {
  const root = mktemp();
  const binaries = fakeBinaries(path.join(root, 'binaries'), [TARGETS[0]]);
  assert.throws(
    () => packPlatforms({ binariesDir: binaries, outDir: path.join(root, 'out'), version: '2.2.0' }),
    /missing binary for aarch64-unknown-linux-musl/
  );
});

test('packPlatforms rejects a non-semver version', () => {
  const root = mktemp();
  const binaries = fakeBinaries(path.join(root, 'binaries'), [TARGETS[0]]);
  assert.throws(
    () =>
      packPlatforms({
        binariesDir: binaries,
        outDir: path.join(root, 'out'),
        version: 'latest',
        targets: [TARGETS[0]],
      }),
    /invalid version/
  );
});

test('the crate version is the release version', () => {
  assert.match(crateVersion(), /^\d+\.\d+\.\d+$/);
});

test('verifyHostBinary rejects a packaged binary with the wrong version', () => {
  if (process.platform === 'win32') return;
  const root = mktemp();
  const binaries = fakeBinaries(path.join(root, 'binaries'));
  const out = path.join(root, 'out');
  const host = hostTarget();
  if (!host) return;

  // Replace the host binary with one that reports a version.
  writeFileSync(
    path.join(binaries, host, binaryName(host)),
    '#!/bin/sh\necho "orderly 2.2.0"\n'
  );
  const entry = TARGETS.find((candidate) => candidate.target === host);
  const dir = path.join(out, packageName(host), 'bin');
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(binaries, host, binaryName(host)), path.join(dir, binaryName(host)));
  chmodSync(path.join(dir, binaryName(host)), 0o755);

  assert.deepEqual(verifyHostBinary(out, '2.2.0'), { verified: true, target: entry.target });
  assert.throws(() => verifyHostBinary(out, '2.3.0'), /expected 2\.3\.0/);
});
