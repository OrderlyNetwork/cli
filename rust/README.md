# orderly (Rust)

A single static binary replacement for the TypeScript `@orderly.network/cli`.
Same commands, flags, output, keychain entries and signatures — but with **no
Node.js runtime** and no `npm install` step, so it installs cleanly on agents
with limited CPU/RAM.

## Build

```bash
cd rust
cargo build --release
# -> rust/target/release/orderly  (~5 MB)
```

`Cargo.toml` uses a size-optimized release profile (`opt-level = "z"`, LTO,
`panic = "abort"`, `strip`).

## Install

Download the binary for your platform from the GitHub release, or build locally
and drop it on your `PATH`:

```bash
install -m 0755 rust/target/release/orderly ~/.local/bin/orderly
```

## Compatibility

- **Same keychain layout as `keytar`.** On Linux the crate talks to the Secret
  Service directly using the `org.freedesktop.Secret.Generic` schema with
  `service`/`account` attributes, so keys created by the TypeScript CLI remain
  readable and vice-versa. On macOS/Windows the OS store is used via `keyring`.
- **Byte-identical signing.** Ed25519 request signatures, EIP-712 typed data and
  the Solana keccak/ABI flows are verified against the TypeScript implementation
  (see `parity/`).
- **Same config path** (`~/.orderly-cli/config.json`).

### Enumeration

`keytar.findCredentials` has no portable Rust equivalent, so credential
*enumeration* (used by `auth-list`, `wallet-list`, and account auto-resolution)
reads `~/.orderly-cli/keys-index.json`. Secrets are still only ever stored in
the OS keychain. Entries created by the TypeScript CLI are readable by exact
account/address but are not enumerated until re-imported.

## Testing

```bash
cargo test                 # unit + offline parity tests (fixtures in parity/fixtures)
cargo clippy --all-targets # must be warning-free
```

Live tests (network) skip automatically when offline:
`tests/api_live.rs`, `tests/ws_live.rs`, `tests/keychain_interop.rs`.

### Parity harness

`parity/gen_*_fixtures.mjs` drive the **real TypeScript implementation** and
record its exact output, so the Rust port can be diffed offline:

| Script | Records |
| --- | --- |
| `gen_output_fixtures.mjs` | `output.ts` JSON/CSV rendering |
| `gen_crypto_fixtures.mjs` | Ed25519 signatures / base58 |
| `gen_evm_fixtures.mjs` | `ethers` EIP-712 + personal_sign |
| `gen_solana_fixtures.mjs` | Solana keccak/ABI signing |

End-to-end, against testnet, comparing both binaries:

```bash
yarn build                                   # in the repo root
cargo build --release --manifest-path rust/Cargo.toml
ACC=<account-id> bash rust/parity/compare_live.sh
```
