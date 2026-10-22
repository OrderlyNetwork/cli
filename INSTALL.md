# Installing `orderly`

`orderly` ships as a single static binary. Pick the archive for your platform
from the [latest release](https://github.com/OrderlyNetwork/cli/releases/latest),
extract it, and put the binary on your `PATH`. There is nothing else to install.

| Platform | Asset |
| --- | --- |
| Linux x86_64 | `orderly-x86_64-unknown-linux-musl.tar.gz` |
| Linux arm64 | `orderly-aarch64-unknown-linux-musl.tar.gz` |
| macOS Apple silicon | `orderly-aarch64-apple-darwin.tar.gz` |
| macOS Intel | `orderly-x86_64-apple-darwin.tar.gz` |
| Windows x86_64 | `orderly-x86_64-pc-windows-msvc.zip` |
| Windows arm64 | `orderly-aarch64-pc-windows-msvc.zip` |

The asset names are not versioned, so the `releases/latest/download/...` URLs
below are stable and can be used in automation.

## Linux

```bash
curl -fsSL https://github.com/OrderlyNetwork/cli/releases/latest/download/orderly-x86_64-unknown-linux-musl.tar.gz | tar -xz
install -m 0755 orderly ~/.local/bin/orderly
```

Use `orderly-aarch64-unknown-linux-musl.tar.gz` on arm64.

The Linux binaries are statically linked against musl: no glibc version
requirements, no Node.js, no shared libraries to install.

## macOS

```bash
# Apple silicon
curl -fsSL https://github.com/OrderlyNetwork/cli/releases/latest/download/orderly-aarch64-apple-darwin.tar.gz | tar -xz
install -m 0755 orderly ~/.local/bin/orderly
```

Use `orderly-x86_64-apple-darwin.tar.gz` on Intel Macs. If `~/.local/bin` is
not on your `PATH`, either add it or install to `/usr/local/bin` instead:

```bash
sudo install -m 0755 orderly /usr/local/bin/orderly
```

No quarantine step is needed: the archives are downloaded with `curl`, not a
browser.

## Windows

```powershell
Invoke-WebRequest https://github.com/OrderlyNetwork/cli/releases/latest/download/orderly-x86_64-pc-windows-msvc.zip -OutFile orderly.zip
Expand-Archive orderly.zip -DestinationPath "$env:LOCALAPPDATA\orderly"
```

Use `orderly-aarch64-pc-windows-msvc.zip` on Windows on ARM. Then add
`$env:LOCALAPPDATA\orderly` to your `PATH`:

```powershell
setx PATH "$env:PATH;$env:LOCALAPPDATA\orderly"
```

## Verify the download

Every release asset is covered by three independent checks. Run them from the
directory containing the downloaded archive.

### 1. Checksum

```bash
base=https://github.com/OrderlyNetwork/cli/releases/latest/download
curl -fsSLO "$base/orderly-x86_64-unknown-linux-musl.tar.gz"
curl -fsSLO "$base/SHA256SUMS"
sha256sum -c --ignore-missing SHA256SUMS
```

### 2. Build provenance (recommended)

This proves the archive was produced by the official
`.github/workflows/release.yml` workflow from the tagged commit. Requires the
[GitHub CLI](https://cli.github.com/) (`gh auth login` is enough; no special
permissions):

```bash
gh attestation verify orderly-x86_64-unknown-linux-musl.tar.gz \
  --repo OrderlyNetwork/cli
```

A passing run reports the digest, the workflow, and the source commit SHA.

### 3. cosign signature (no GitHub account needed)

Each archive has a Sigstore bundle next to it
(`<asset>.sigstore.json`), signed keylessly by GitHub Actions and recorded in
the public Rekor transparency log.

```bash
curl -fsSLO https://github.com/OrderlyNetwork/cli/releases/latest/download/orderly-x86_64-unknown-linux-musl.tar.gz.sigstore.json

cosign verify-blob \
  --bundle orderly-x86_64-unknown-linux-musl.tar.gz.sigstore.json \
  --certificate-identity-regexp '^https://github\.com/OrderlyNetwork/cli/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  orderly-x86_64-unknown-linux-musl.tar.gz
```

What these do and do not prove: they bind the binary's hash to the tagged commit
and the official build workflow, which is what "built from this source" means in
practice. They do not guarantee bit-for-bit reproducibility (Rust builds are not
reproducible across toolchains and OS versions), and they do not assert that the
source was reviewed.

`BUILD-INFO.txt` in each release records the tag, commit, workflow run URL and
`Cargo.lock` hash for humans.

## Build from source

If you would rather compile it yourself, or your platform is not listed:

```bash
git clone https://github.com/OrderlyNetwork/cli
cd cli
cargo build --release --locked
install -m 0755 target/release/orderly ~/.local/bin/orderly
```

Or install straight from the repository with Cargo (slower than downloading the
binary, and requires a Rust toolchain):

```bash
cargo install --git https://github.com/OrderlyNetwork/cli --locked
```

Building from source is the strongest verification available: the binary is
produced on your machine from the code you checked out.

## Uninstall

```bash
rm ~/.local/bin/orderly
```

Credentials live in the OS keychain, not next to the binary. Remove them with
`orderly auth-cleanup` and `orderly wallet-remove <address>` before deleting the
binary if you also want to clear stored keys.
