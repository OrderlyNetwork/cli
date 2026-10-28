#!/bin/sh
# Install the Orderly trading CLI from the latest signed GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/OrderlyNetwork/cli/master/install.sh | sh
#
# Environment:
#   ORDERLY_INSTALL_DIR  target directory (default: ~/.local/bin)
#   ORDERLY_VERSION      release tag to install, e.g. v2.0.1 (default: latest)
#
# Writes one file, the `orderly` binary. Nothing else is installed and no
# existing configuration or keychain state is touched.

set -eu

REPO="OrderlyNetwork/cli"
BIN="orderly"
INSTALL_DIR="${ORDERLY_INSTALL_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
err() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Install the Orderly trading CLI from the latest signed GitHub release.

  curl -fsSL https://orderly.network/cli.sh | sh

Environment:
  ORDERLY_INSTALL_DIR  target directory (default: ~/.local/bin)
  ORDERLY_VERSION      release tag to install, e.g. v2.0.1 (default: latest)
EOF
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
  "") ;;
  *) err "unknown argument: $1 (try --help)" ;;
esac

need() {
  command -v "$1" >/dev/null 2>&1 || err "missing required command: $1"
}

need curl
need tar
need uname

os=$(uname -s)
arch=$(uname -m)

case "$os" in
  Linux) os_part="unknown-linux-musl" ;;
  Darwin) os_part="apple-darwin" ;;
  *)
    err "unsupported OS: $os. On Windows see https://github.com/$REPO/blob/master/INSTALL.md"
    ;;
esac

case "$arch" in
  x86_64 | amd64) arch_part="x86_64" ;;
  arm64 | aarch64) arch_part="aarch64" ;;
  *) err "unsupported architecture: $arch" ;;
esac

asset="$BIN-$arch_part-$os_part.tar.gz"
base="https://github.com/$REPO/releases"
if [ "${ORDERLY_VERSION:-latest}" = "latest" ]; then
  base="$base/latest/download"
else
  base="$base/download/$ORDERLY_VERSION"
fi

tmp=$(mktemp -d 2>/dev/null || mktemp -d -t orderly)
trap 'rm -rf "$tmp"' EXIT INT TERM

say "Downloading $asset ..."
curl -fsSL "$base/$asset" -o "$tmp/$asset" || err "download failed: $base/$asset"

# Checksum verification against the release's SHA256SUMS. Best-effort: warn
# rather than fail when no SHA-256 tool is available, but fail hard on a
# mismatch.
if curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" 2>/dev/null; then
  expected=$(awk -v f="$asset" '$2 == f || $2 == "*"f { print $1; exit }' "$tmp/SHA256SUMS" 2>/dev/null || true)
  if [ -n "${expected:-}" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual=$(sha256sum "$tmp/$asset" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
      actual=$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')
    else
      actual=""
      say "warning: no sha256sum or shasum found; skipping checksum verification"
    fi
    if [ -n "$actual" ] && [ "$actual" != "$expected" ]; then
      err "checksum mismatch for $asset"
    fi
  else
    say "warning: $asset is not listed in SHA256SUMS; skipping checksum verification"
  fi
else
  say "warning: could not fetch SHA256SUMS; skipping checksum verification"
fi

tar -xzf "$tmp/$asset" -C "$tmp" "$BIN" 2>/dev/null || tar -xzf "$tmp/$asset" -C "$tmp"
[ -f "$tmp/$BIN" ] || err "archive did not contain $BIN"

mkdir -p "$INSTALL_DIR"
if ! install -m 0755 "$tmp/$BIN" "$INSTALL_DIR/$BIN" 2>/dev/null; then
  cp "$tmp/$BIN" "$INSTALL_DIR/$BIN"
  chmod 0755 "$INSTALL_DIR/$BIN"
fi

say "Installed $INSTALL_DIR/$BIN"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    say ""
    say "$INSTALL_DIR is not on your PATH. Add it with:"
    say "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

"$INSTALL_DIR/$BIN" --version 2>/dev/null || true
