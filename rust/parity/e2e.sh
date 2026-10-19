#!/usr/bin/env bash
# End-to-end parity battery between the Rust and TypeScript CLIs.
#
# Every case here is NON-DESTRUCTIVE and requires no account balance, so it is
# safe to run repeatedly. Cases that would create/delete wallets, revoke keys,
# or move funds are deliberately excluded (see compare_live.sh for the
# read-only live set and its warning).
#
# Usage:
#   bash rust/parity/e2e.sh                 # public + arg-parsing cases
#   ACC=<account-id> bash rust/parity/e2e.sh  # also authenticated cases

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
volatile=0

check() {
  $TS "$@" >"$TMP/ts" 2>&1
  t=$?
  $RS "$@" >"$TMP/rs" 2>&1
  r=$?
  if diff -q "$TMP/ts" "$TMP/rs" >/dev/null && [ "$t" = "$r" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "DIFF ts=$t rs=$r : $*"
    diff "$TMP/ts" "$TMP/rs" | head -4 | sed 's/^/       /'
  fi
}

# Commands whose output contains live prices can differ between the two
# invocations purely from market drift; report but do not fail on them.
check_volatile() {
  $TS "$@" >"$TMP/ts" 2>&1
  $RS "$@" >"$TMP/rs" 2>&1
  if diff -q "$TMP/ts" "$TMP/rs" >/dev/null; then
    pass=$((pass + 1))
  else
    volatile=$((volatile + 1))
    echo "drift  $*"
  fi
}

# --- top-level help / version -----------------------------------------------
check --help
check -h
check help
check not-a-command

# --- public market data (prices drift between the two invocations) -----------
check_volatile market-price PERP_ETH_USDC
check_volatile symbols
check_volatile symbols --info
check_volatile symbols --csv
check_volatile funding-rates
check_volatile price-changes
check_volatile open-interest
check_volatile market-trades PERP_ETH_USDC --size 5
check_volatile market-orderbook PERP_ETH_USDC --depth 3
# --- public metadata (stable) ------------------------------------------------
check chains
check chains --verbose
check tokens
check system-status
check liquidated-positions
check deposit-info USDC 421614

# --- argument / validation errors (deterministic) ---------------------------
check market-price NOTASYMBOL
check market-price perp-eth-usdc
check kline PERP_ETH_USDC bogus
check kline PERP_ETH_USDC 1h --size 0
check order-place
check order-place PERP_ETH_USDC
check order-place PERP_ETH_USDC BADMARKET 0.01
check order-place PERP_ETH_USDC BUY LIMIT 0.01
check order-place PERP_ETH_USDC BID -5
check order-place PERP_ETH_USDC BUY MARKET 0
check algo-order-place PERP_ETH_USDC SELL STOP 0.01
check algo-order-place PERP_ETH_USDC SELL TP_SL 0.01
check algo-order-place PERP_ETH_USDC SELL TRAILING_STOP 0.01
check algo-order-place PERP_ETH_USDC SELL BRACKET 0.01
check algo-order-place PERP_ETH_USDC XXX STOP 0.01 --trigger-price 1
check batch-order-place '[]'
check batch-order-place 'not json'
check batch-order-place '[{"symbol":"PERP_ETH_USDC"}]'
check withdraw USDC 421614
check withdraw USDC 999999 --amount 1
check deposit-info USDC 999999
check deposit-info NOPE 421614
check positions-close
check faucet-usdc 0x1234 --chain-id 421614 --network mainnet
check leverage
check leverage PERP_ETH_USDC abc

# --- authenticated, non-mutating (needs ACC) ---------------------------------
if [ -n "$ACC" ]; then
  check account-info --account "$ACC" --network "$NET"
  check account-balance --account "$ACC" --network "$NET"
  check account-statistics --account "$ACC" --network "$NET"
  check account-limits --account "$ACC" --network "$NET"
  check account-limits --symbol PERP_ETH_USDC --account "$ACC" --network "$NET"
  check account-liquidations --account "$ACC" --network "$NET"
  check key-info --account "$ACC" --network "$NET"
  check fee-tier --account "$ACC" --network "$NET"
  check positions-list --account "$ACC" --network "$NET"
  check positions-history --account "$ACC" --network "$NET"
  check trades --account "$ACC" --network "$NET"
  check funding-history --account "$ACC" --network "$NET"
  check settle-pnl-history --account "$ACC" --network "$NET"
  check algo-order-list --account "$ACC" --network "$NET"
  check algo-order-get 999999999 --account "$ACC" --network "$NET"
  check referral-info --account "$ACC" --network "$NET"
  check volume-stats --account "$ACC" --network "$NET"
  check distribution-history --account "$ACC" --network "$NET"
  check notification-inbox --account "$ACC" --network "$NET"
  check notification-unread --account "$ACC" --network "$NET"
  check asset-history --account "$ACC" --network "$NET"
  # signed write that needs no balance: setting leverage
  check leverage PERP_ETH_USDC 10 --account "$ACC" --network "$NET"
  check leverage PERP_ETH_USDC --account "$ACC" --network "$NET"
  # signed order request rejected by business rules (proves body+signature)
  check order-place PERP_ETH_USDC BUY LIMIT 0.001 --price 1000 --account "$ACC" --network "$NET"
  check order-cancel 999999999 --account "$ACC" --network "$NET"
  check algo-order-cancel 999999999 --account "$ACC" --network "$NET"
  check order-edit 999999999 --price 100 --account "$ACC" --network "$NET"
  check order-cancel-by-client-id nope123 PERP_ETH_USDC --account "$ACC" --network "$NET"
  check algo-order-cancel-by-client-id nope123 PERP_ETH_USDC --account "$ACC" --network "$NET"
  check positions-close PERP_ETH_USDC --account "$ACC" --network "$NET"
  check order-trades 999999999 --account "$ACC" --network "$NET"
  check algo-order-trades 999999999 --account "$ACC" --network "$NET"
else
  echo "SKIP: authenticated cases (set ACC=<account-id>)"
fi

echo
echo "passed=$pass failed=$fail drift=$volatile"
[ "$fail" -eq 0 ]
