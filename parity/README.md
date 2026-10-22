# Parity fixtures

These files were recorded from the original TypeScript implementation
(`@orderly.network/cli` 1.2.0) before it was removed in the Rust-only v2.0.0
release, so the Rust CLI stays pinned to its exact behavior without needing a
Node.js toolchain.

| File | Records |
| --- | --- |
| `output.json` | `render()` JSON / CSV output, including JS number formatting |
| `crypto.json` | Ed25519 key derivation, base58 encoding and request signatures |
| `evm.json` | `ethers` EIP-712 and `personal_sign` signatures |
| `solana.json` | Solana message-body JSON and signatures |
| `help.txt` | full `orderly --help` text |

The Rust tests in `tests/parity_*.rs` diff against these bytes offline. Treat
them as frozen: edit only to document an intentional behavior change.
`help.txt` also contains the version line, which the help test normalizes to the
current crate version (`Cargo.toml`).
