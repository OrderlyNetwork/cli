import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Native binaries ship as one npm package per platform. This map is the only
 * place the launcher and the packer agree on which package holds which target;
 * the packer's TARGETS list in scripts/npm-platforms.mjs must match.
 */
const PACKAGES = {
  'linux-x64': '@orderly.network/cli-linux-x64',
  'linux-arm64': '@orderly.network/cli-linux-arm64',
  'darwin-x64': '@orderly.network/cli-darwin-x64',
  'darwin-arm64': '@orderly.network/cli-darwin-arm64',
  'win32-x64': '@orderly.network/cli-win32-x64',
  'win32-arm64': '@orderly.network/cli-win32-arm64',
};

const requireFromHere = createRequire(import.meta.url);
const defaultResolve = (id) => requireFromHere.resolve(id);

/** npm package that carries the binary for a platform/arch pair. */
export function packageForPlatform(platform, arch) {
  return PACKAGES[`${platform}-${arch}`] ?? null;
}

/** Executable file name inside the platform package. */
export function binaryName(platform) {
  return platform === 'win32' ? 'orderly.exe' : 'orderly';
}

/**
 * Absolute path of the native binary for this machine.
 *
 * `resolve` is injectable so the mapping and error paths are testable without
 * a real install.
 */
export function resolveBinary(
  platform = process.platform,
  arch = process.arch,
  resolve = defaultResolve
) {
  const pkg = packageForPlatform(platform, arch);
  if (!pkg) {
    throw new Error(
      `orderly: no prebuilt CLI for ${platform}-${arch}.\n` +
        'Supported platforms: linux (x64, arm64), macOS (x64, arm64), Windows (x64, arm64).\n' +
        'Build from source instead: cargo install --path .'
    );
  }

  let manifest;
  try {
    manifest = resolve(`${pkg}/package.json`);
  } catch {
    throw new Error(
      `orderly: ${pkg} is not installed.\n` +
        'It is an optional dependency of @orderly.network/cli, so the install either\n' +
        'skipped optional dependencies or filtered by platform. Reinstall with:\n' +
        '  npm install -g @orderly.network/cli --include=optional'
    );
  }

  return path.join(path.dirname(manifest), 'bin', binaryName(platform));
}
