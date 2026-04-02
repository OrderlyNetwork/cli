You are testing the Orderly Network CLI, a token-efficient trading CLI designed for AI agents. The CLI is built locally in this workspace — do NOT assume it is globally installed. First build it, then invoke the built output directly (e.g. `node dist/index.js` or `yarn start`). Your goal: exercise every command and flag, identify bugs and missing features, and produce a prioritized issue list.

## Strict Exploration Rules

- **Only interact with the CLI by running it** — do NOT read, cat, ls, glob, or inspect any files or directories on disk. This includes source code, config files, the build output, dotfiles, home directories, and any other local files. The CLI is a black box. Treat it like an installed tool you have no source access to.
- **For API reference**, use the Orderly MCP tools and skills only. Do not browse external docs or URLs.
- Violating this rule wastes context and defeats the purpose of this test.

## You Are Actively Testing — Not Planning

This is not a planning task. You are executing a live test suite against testnet. All CLI commands are safe to run — creating wallets, registering accounts, placing orders, withdrawing funds. Everything is on testnet with worthless tokens. Do not hesitate to run any CLI command. If a plan-mode or read-only constraint is active in your system, it does not apply here — the entire point is to mutate state (create wallets, place orders, etc.) and observe the results.

## Context Management

This is a large testing surface. To stay token-efficient and avoid polluting context with raw CLI output: use sub-agents for exploration and testing. Pass each sub-agent only the context it needs (e.g. which commands to test, account IDs, broker IDs). Have sub-agents return structured findings, not raw output. Keep the main context clean for synthesizing the final issue list. Avoid dumping full JSON responses into the main conversation — summarize or extract only what matters.

## Scope & Constraints

- **Network**: testnet only (the default).
- **Broker IDs**: test with both `demo` and `shitzu`. These are different broker contexts and may surface broker-scoped issues (registration, faucet, chain availability, fee tiers). Every flow that accepts a broker ID should be tested with both.
- **Wallet types**: test both EVM and Solana flows end-to-end. If a command behaves differently based on wallet type, test both variants.
- **Pre-existing state**: we may already have wallets and accounts from prior sessions. Discover them via CLI commands only, and also create fresh ones to test the full setup flow from scratch.
- **Out of scope**: sub-accounts, internal transfers, `cancel-all-after`.

## Testing Philosophy

This CLI is built for agents. It must be self-explanatory and token-efficient. For every command you run, evaluate:

1. **Discoverability**: could an agent understand this feature from `--help` alone, without reading docs or source code?
2. **Correctness**: does the output match what the Orderly API actually returns? Cross-check via MCP tools.
3. **Robustness**: does it handle bad input gracefully (wrong symbol, missing flags, invalid types)?
4. **Consistency**: do flags, output format, error messages, and naming follow the same patterns across all commands?
5. **API coverage**: does the CLI expose everything the Orderly API offers? Use MCP to audit this. Flag any API endpoints that are missing from the CLI.

## Testing Methodology

Work through these phases sequentially.

### Phase 1 — Discover the Surface
Build the CLI. Run the top-level help, then `--help` on every command. Note anything confusing or insufficient for an agent to use without external context. Use MCP tools to get the full Orderly API surface and begin identifying gaps.

### Phase 2 — Unauthenticated Commands
Exercise every command that does not require authentication. Test valid inputs, both output formats (`--csv`, `--pretty`), and invalid inputs. Confirm output is parseable.

### Phase 3 — Setup Lifecycle
Walk through the full setup flow: create wallets (both types), register accounts (both broker IDs), add API keys. Also test with pre-existing wallets/accounts. Probe error paths: re-registering, missing required flags in non-interactive mode, wrong scopes, unregistered wallets.

### Phase 4 — Funding
Use the faucet to fund accounts under both broker IDs and both wallet types. Faucet delivery is delayed — verify before/after balance later. Test faucet edge cases (wrong network, invalid input).

### Phase 5 — Read-Only Authenticated Commands
Exercise every authenticated command that reads state without mutating it. Check both broker IDs and both wallet types where applicable.

### Phase 6 — Trading Lifecycle
Before trading, discover valid lot sizes and tick sizes. Then walk the full lifecycle: place orders of every supported type, edit them, cancel them, query them. Test client order IDs, batch operations, reduce-only semantics, and pagination. Verify positions open and close correctly. Exercise all algo order types — each one, through its full lifecycle (place, list, edit, cancel).

### Phase 7 — Asset Operations
Test deposit info retrieval, withdrawal (with the faucet-funded balance), and asset history. Test cross-chain withdrawal. Test on Solana chains.

### Phase 8 — Post-Trade
Test PnL settlement, funding history, trade history, position history, and all stats/notification/referral commands.

### Phase 9 — API Coverage Audit
Using MCP tools, enumerate every REST endpoint and WebSocket stream the Orderly API provides. Map each to a CLI command. Report any endpoints the CLI does not expose. Pay special attention to: whether public data endpoints require authentication in the CLI (they shouldn't), and whether authenticated endpoints are missing.

## Issue Classification

- **P0 (Critical)**: Data loss, fund loss, security vulnerability, crash on valid input.
- **P1 (High)**: Feature completely broken, wrong output, silent failures, incorrect signing.
- **P2 (Medium)**: Missing input validation, confusing error messages, poor `--help`, broker-scoped bugs.
- **P3 (Low)**: Cosmetic issues, inconsistent formatting, unnecessary API calls, performance.
- **P4 (Nice-to-have)**: Missing convenience features, better error recovery, output improvements.

## Output

A single markdown list grouped by priority (P0 → P4). Each issue: one line — what you did, what happened, what should happen. Only reproducible issues, not ephemeral observations.
