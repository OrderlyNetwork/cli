import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  binaryName,
  packageForPlatform,
  resolveBinary,
} from '../../npm/cli/lib/resolve.js';
import { TARGETS, launcherManifest, packLauncher } from '../npm-platforms.mjs';

function mktemp() {
  return mkdtempSync(path.join(tmpdir(), 'orderly-cli-launcher-'));
}

test('resolves one npm package per supported platform', () => {
  assert.equal(packageForPlatform('linux', 'x64'), '@orderly.network/cli-linux-x64');
  assert.equal(packageForPlatform('linux', 'arm64'), '@orderly.network/cli-linux-arm64');
  assert.equal(packageForPlatform('darwin', 'x64'), '@orderly.network/cli-darwin-x64');
  assert.equal(packageForPlatform('darwin', 'arm64'), '@orderly.network/cli-darwin-arm64');
  assert.equal(packageForPlatform('win32', 'x64'), '@orderly.network/cli-win32-x64');
  assert.equal(packageForPlatform('win32', 'arm64'), '@orderly.network/cli-win32-arm64');
  assert.equal(packageForPlatform('freebsd', 'x64'), null);
});

test('uses orderly.exe on windows only', () => {
  assert.equal(binaryName('win32'), 'orderly.exe');
  assert.equal(binaryName('linux'), 'orderly');
});

test('resolveBinary finds the binary beside the platform package manifest', () => {
  const dir = mktemp();
  const manifest = path.join(dir, 'node_modules', '@orderly.network', 'cli-linux-x64', 'package.json');
  mkdirSync(path.dirname(manifest), { recursive: true });
  writeFileSync(manifest, '{}');

  const bin = resolveBinary('linux', 'x64', () => manifest);
  assert.equal(
    bin,
    path.join(path.dirname(manifest), 'bin', 'orderly')
  );
  assert.equal(resolveBinary('win32', 'x64', () => manifest).endsWith('orderly.exe'), true);
});

test('unsupported platforms get an actionable error', () => {
  assert.throws(
    () => resolveBinary('freebsd', 'x64', () => {
      throw new Error('should not resolve');
    }),
    /no prebuilt CLI for freebsd-x64/
  );
});

test('a skipped optional dependency explains how to reinstall', () => {
  assert.throws(
    () =>
      resolveBinary('linux', 'x64', () => {
        throw new Error('MODULE_NOT_FOUND');
      }),
    (error) => {
      assert.match(error.message, /@orderly\.network\/cli-linux-x64 is not installed/);
      assert.match(error.message, /--include=optional/);
      return true;
    }
  );
});

test('launcher manifest pins every platform package to the release', () => {
  const manifest = launcherManifest('2.2.2');
  assert.equal(manifest.name, '@orderly.network/cli');
  assert.deepEqual(manifest.bin, { orderly: 'bin/orderly.js' });
  assert.equal(Object.keys(manifest.optionalDependencies).length, TARGETS.length);
  for (const entry of TARGETS) {
    assert.equal(manifest.optionalDependencies[packageForPlatform(entry.os, entry.cpu)], '2.2.2');
  }
});

test('packLauncher writes an installable package with an executable bin', () => {
  const root = mktemp();
  const out = path.join(root, 'out');
  const dir = packLauncher({ outDir: out, version: '2.2.2' });

  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@orderly.network/cli');
  assert.equal(manifest.version, '2.2.2');
  assert.equal(manifest.type, 'module');
  assert.deepEqual(manifest.files, ['bin', 'lib', 'README.md']);

  const bin = path.join(dir, 'bin', 'orderly.js');
  assert.ok(statSync(bin).size > 0);
  assert.equal(statSync(bin).mode & 0o777, 0o755);
  assert.ok(statSync(path.join(dir, 'lib', 'resolve.js')).size > 0);
});

test('packLauncher rejects a non-semver version', () => {
  assert.throws(
    () => packLauncher({ outDir: mktemp(), version: 'latest' }),
    /invalid version/
  );
});
