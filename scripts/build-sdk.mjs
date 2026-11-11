#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const jsDir = path.resolve(here, "..");
const wasmCrate = path.resolve(jsDir, "bindings/wasm");
const outDir = path.resolve(jsDir, "wasm");

// Rust embeds absolute source paths in panic locations. Remap the checkout,
// Cargo home, and Rustup home so a CI rebuild is byte-identical to a local one.
const cargoHome = process.env.CARGO_HOME || path.join(homedir(), ".cargo");
const rustupHome = process.env.RUSTUP_HOME || path.join(homedir(), ".rustup");
const remaps = [
  `${jsDir}=/orderly`,
  `${cargoHome}=/cargo`,
  `${rustupHome}=/rustup`,
].map((entry) => `--remap-path-prefix=${entry}`);
process.env.RUSTFLAGS = [process.env.RUSTFLAGS, ...remaps]
  .filter(Boolean)
  .join(" ");

execFileSync(
  "cargo",
  ["build", "--release", "--target", "wasm32-unknown-unknown"],
  { cwd: wasmCrate, stdio: "inherit" },
);

rmSync(outDir, { recursive: true, force: true });
execFileSync(
  "wasm-bindgen",
  [
    "--target",
    "web",
    "--out-dir",
    outDir,
    "--out-name",
    "orderly_wasm",
    path.join(wasmCrate, "target/wasm32-unknown-unknown/release/orderly_wasm.wasm"),
  ],
  { stdio: "inherit" },
);

const wasmBytes = readFileSync(path.join(outDir, "orderly_wasm_bg.wasm"));
writeFileSync(
  path.join(outDir, "orderly_wasm_base64.js"),
  `export const wasmBase64 = ${JSON.stringify(wasmBytes.toString("base64"))};\n`,
);
writeFileSync(
  path.join(outDir, "orderly_wasm_base64.d.ts"),
  "export declare const wasmBase64: string;\n",
);

execFileSync("pnpm", ["exec", "tsc", "-p", "sdk/tsconfig.json"], {
  cwd: jsDir,
  stdio: "inherit",
});

// A path-independent fingerprint of the inputs that affect the artifacts.
// wasm-bindgen output is not byte-identical across checkout paths (Rust embeds
// path-derived symbol metadata), so CI compares this hash instead.
const sourceFiles = [
  "Cargo.toml",
  "Cargo.lock",
  "src/lib.rs",
  "src/colors.rs",
  "src/crypto.rs",
  "src/error.rs",
  "src/request.rs",
  "src/types.rs",
  "bindings/wasm/Cargo.toml",
  "bindings/wasm/Cargo.lock",
  "bindings/wasm/src/lib.rs",
  "sdk/index.ts",
  "sdk/tsconfig.json",
];

function normalizedSource(file) {
  const text = readFileSync(path.join(jsDir, file), "utf8");
  // A release bumps only the package version; that must not invalidate the
  // prebuilt WASM. Normalize the CLI package version fields before hashing.
  if (file === "Cargo.toml") {
    return text.replace(/^version = ".*"$/m, 'version = "0.0.0"');
  }
  if (file.endsWith("Cargo.lock")) {
    return text.replace(
      /(\[\[package\]\]\nname = "orderly"\nversion = ")[^"]+(")/,
      (_match, before, after) => `${before}0.0.0${after}`,
    );
  }
  return text;
}

const hash = createHash("sha256");
for (const file of sourceFiles) {
  hash.update(file);
  hash.update("\0");
  hash.update(normalizedSource(file));
  hash.update("\0");
}
writeFileSync(path.join(outDir, "source-hash.txt"), `${hash.digest("hex")}\n`);
