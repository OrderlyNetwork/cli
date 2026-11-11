#!/usr/bin/env node
/**
 * Keep the CLI binary version and the npm package version in lockstep.
 *
 * `npm version` runs this after updating package.json, so a vX.Y.Z tag matches
 * Cargo.toml and the GitHub release workflow can build the same version.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = process.env.npm_package_version ?? pkg.version;

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid version: ${version}`);
  process.exit(1);
}

const cargoPath = path.join(root, "Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
if (!/\[package\][\s\S]*?version = "[^"]+"/.test(cargo)) {
  console.error("Could not find the [package] version in Cargo.toml");
  process.exit(1);
}
const nextCargo = cargo.replace(
  /(\[package\][\s\S]*?version = ")[^"]+(")/,
  `$1${version}$2`,
);
writeFileSync(cargoPath, nextCargo);

const lockPaths = [
  path.join(root, "Cargo.lock"),
  path.join(root, "bindings/wasm/Cargo.lock"),
];
for (const lockPath of lockPaths) {
  const lock = readFileSync(lockPath, "utf8");
  if (!/\[\[package\]\]\nname = "orderly"\nversion = "[^"]+"/.test(lock)) {
    console.error(`Could not find the "orderly" package in ${lockPath}`);
    process.exit(1);
  }
  writeFileSync(
    lockPath,
    lock.replace(
      /(\[\[package\]\]\nname = "orderly"\nversion = ")[^"]+(")/,
      `$1${version}$2`,
    ),
  );
}

try {
  execFileSync(
    "git",
    [
      "add",
      "Cargo.toml",
      "Cargo.lock",
      "bindings/wasm/Cargo.lock",
    ],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
} catch {
  // Not a git checkout (for example an npm tarball). The file updates still apply.
}

console.log(`Synced CLI and SDK version to ${version}`);
