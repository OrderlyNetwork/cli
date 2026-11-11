#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "wasm/orderly_wasm.js",
  "wasm/orderly_wasm_base64.js",
  "wasm/orderly_wasm_bg.wasm",
  "wasm/source-hash.txt",
];

const missing = required.filter((file) => !existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Missing SDK artifacts:\n${missing.map((file) => `  ${file}`).join("\n")}`);
  console.error("Run `pnpm build` from the repository root.");
  process.exit(1);
}
console.log(`SDK artifacts present (${required.length} files).`);
