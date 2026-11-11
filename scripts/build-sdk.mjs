#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const jsDir = path.resolve(here, "..");
const wasmCrate = path.resolve(jsDir, "bindings/wasm");
const outDir = path.resolve(jsDir, "wasm");

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
