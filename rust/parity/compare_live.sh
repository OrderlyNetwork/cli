#!/usr/bin/env bash
# Compares the Rust CLI against the TypeScript CLI for a battery of commands.
#
# ONLY read-only / non-mutating commands belong here. Never add wallet-remove,
# auth-logout, auth-cleanup, or wallet-revoke-key: they delete keychain entries.
#
# Usage:
#   ACC=<account-id> bash rust/parity/compare_live.sh
#
# Requires: the TS CLI built (yarn build) and the Rust CLI built
# (cargo build --release, so rust/target/release/orderly exists).

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TS="node $ROOT/dist/index.js"
RS="$ROOT/rust/target/release/orderly"
ACC="${ACC:-}"
NET="${NET:-testnet}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
drift=0

check() {
  # shellcheck disable=SC2086
  $TS "$@" --network "$NET" >"$TMP/ts" 2>&1
  t=$?
  # shellcheck disable=SC2086
  $RS "$@" --network "$NET" >"$TMP/rs" 2>&1
  r=$?
  if diff -q "$TMP/ts" "$TMP/rs" >/dev/null && [ "$t" = "$r" ]; then
    echo "MATCH  $*"
    pass=$((pass + 1))
  else
    echo "DIFF   ts=$t rs=$r : $*"
    diff "$TMP/ts" "$TMP/rs" | head -4 | sed 's/^/       /'
    fail=$((fail + 1))
  fi
}

# Outputs containing live prices drift between the two invocations; report but
# do not fail on them.
check_volatile() {
  # shellcheck disable=SC2086
  $TS "$@" --network "$NET" >"$TMP/ts" 2>&1
  # shellcheck disable=SC2086
  $RS "$@" --network "$NET" >"$TMP/rs" 2>&1
  if diff -q "$TMP/ts" "$TMP/rs" >/dev/null; then
    echo "MATCH  $*"
    pass=$((pass + 1))
  else
    echo "drift  $*"
    drift=$((drift + 1))
  fi
}

# --- public / unauthenticated -------------------------------------------------
check chains
check chains --verbose
check tokens
check tokens --verbose
check_volatile symbols
check_volatile symbols --info
check_volatile symbols --csv
check_volatile funding-rates
check_volatile price-changes
check_volatile open-interest
check_volatile liquidated-positions
check system-status
check_volatile market-price PERP_ETH_USDC
check_volatile market-trades PERP_ETH_USDC --size 5
check deposit-info USDC 421614

# --- deterministic CLI surface (no network) -----------------------------------
check not-a-command
check market-price NOTASYMBOL
check order-place PERP_ETH_USDC BADMARKET 0.01
check order-place PERP_ETH_USDC BID -5
check kline PERP_ETH_USDC bogus

# --- authenticated read-only (needs ACC) --------------------------------------
if [ -n "$ACC" ]; then
  check account-info --account "$ACC"
  check account-balance --account "$ACC"
  check account-statistics --account "$ACC"
  check account-limits --account "$ACC"
  check account-limits --symbol PERP_ETH_USDC --account "$ACC"
  check key-info --account "$ACC"
  check fee-tier --account "$ACC"
  check positions-list --account "$ACC"
  check positions-history --account "$ACC"
  check trades --account "$ACC"
  check funding-history --account "$ACC"
  check settle-pnl-history --account "$ACC"
  check algo-order-list --account "$ACC"
  check referral-info --account "$ACC"
  check volume-stats --account "$ACC"
  check distribution-history --account "$ACC"
  check notification-inbox --account "$ACC"
  check notification-unread --account "$ACC"
  check asset-history --account "$ACC"
else
  echo "SKIP: authenticated checks (set ACC=<account-id>)"
fi

echo
echo "passed=$pass failed=$fail drift=$drift"
[ "$fail" -eq 0 ]
