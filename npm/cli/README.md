# @orderly.network/cli

The Orderly Network CLI. Installs the native `orderly` binary for your platform
as an optional dependency — no install scripts, nothing downloaded at runtime.

## Install

```sh
npm install -g @orderly.network/cli
orderly --version
```

Or without installing:

```sh
npx @orderly.network/cli auth-list
```

### Platforms

| OS | Architectures |
| --- | --- |
| Linux (static musl) | x86_64, arm64 |
| macOS | x86_64, arm64 |
| Windows | x86_64, arm64 |

The binary lives in `@orderly.network/cli-<os>-<cpu>`. If your npm config skips
optional dependencies, reinstall with `--include=optional`.

## What it is not

- **Not a JavaScript API.** Programmatic request building and signing (browser,
  Workers, Node) is [`@orderly.network/cli-wasm`](https://www.npmjs.com/package/@orderly.network/cli-wasm).
- **Not key storage in the package.** Wallet and API keys live in the OS keychain
  (macOS Keychain, Windows Credential Manager, Linux Secret Service).

## Links

- Source: https://gitlab.com/orderlynetwork/orderly-fe/cli
- Installation, verification, building from source: `INSTALL.md` in the repository
