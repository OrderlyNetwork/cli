//! Locks the CLI surface to the TypeScript command set so it cannot silently
//! drift (command names, global flags, and representative parses).

use clap::{CommandFactory, Parser};
use orderly::cli::Cli;

const EXPECTED_COMMANDS: &[&str] = &[
    "account-balance",
    "account-info",
    "account-limits",
    "account-liquidations",
    "account-statistics",
    "algo-order-cancel",
    "algo-order-cancel-all",
    "algo-order-cancel-by-client-id",
    "algo-order-edit",
    "algo-order-get",
    "algo-order-list",
    "algo-order-place",
    "algo-order-trades",
    "asset-history",
    "auth-cleanup",
    "auth-export-key",
    "auth-import",
    "auth-list",
    "auth-logout",
    "auth-show",
    "batch-order-cancel",
    "batch-order-cancel-by-client-id",
    "batch-order-place",
    "broker-create",
    "broker-status",
    "chains",
    "deposit-info",
    "distribution-history",
    "faucet-usdc",
    "fee-tier",
    "funding-history",
    "funding-rates",
    "key-info",
    "kline",
    "leverage",
    "liquidated-positions",
    "market-orderbook",
    "market-price",
    "market-trades",
    "notification-inbox",
    "notification-unread",
    "open-interest",
    "order-cancel",
    "order-cancel-all",
    "order-cancel-by-client-id",
    "order-edit",
    "order-get",
    "order-list",
    "order-place",
    "order-trades",
    "positions-close",
    "positions-history",
    "positions-list",
    "price-changes",
    "referral-info",
    "settle-pnl",
    "settle-pnl-history",
    "symbols",
    "system-status",
    "tokens",
    "trades",
    "volume-stats",
    "wallet-add-key",
    "wallet-create",
    "wallet-import",
    "wallet-list",
    "wallet-logout",
    "wallet-register",
    "wallet-remove",
    "wallet-revoke-key",
    "wallet-show",
    "withdraw",
];

#[test]
fn exposes_exactly_the_typescript_command_surface() {
    let cmd = Cli::command();
    let mut got: Vec<String> = cmd
        .get_subcommands()
        .map(|c| c.get_name().to_string())
        .collect();
    got.sort();

    let mut expected: Vec<String> = EXPECTED_COMMANDS.iter().map(|s| s.to_string()).collect();
    expected.sort();

    assert_eq!(got.len(), 72, "expected 72 subcommands, got {}", got.len());
    assert_eq!(got, expected);
}

#[test]
fn global_flags_are_declared() {
    let cmd = Cli::command();
    let ids: Vec<String> = cmd
        .get_arguments()
        .map(|a| a.get_id().to_string())
        .collect();
    for flag in ["network", "csv", "pretty"] {
        assert!(ids.contains(&flag.to_string()), "missing global --{flag}");
    }
}

#[test]
fn parses_representative_invocations() {
    let cases: Vec<Vec<&str>> = vec![
        vec!["orderly", "market-price", "PERP_ETH_USDC"],
        vec![
            "orderly",
            "order-place",
            "PERP_ETH_USDC",
            "BUY",
            "MARKET",
            "0.01",
        ],
        vec!["orderly", "order-place", "PERP_ETH_USDC", "BID", "0.01"],
        vec![
            "orderly",
            "algo-order-place",
            "PERP_ETH_USDC",
            "SELL",
            "STOP",
            "0.01",
        ],
        vec![
            "orderly",
            "account-balance",
            "--account",
            "0xabc",
            "--network",
            "testnet",
        ],
        vec!["orderly", "kline", "PERP_ETH_USDC", "1h", "--size", "30"],
        vec!["orderly", "symbols", "--csv"],
        vec!["orderly", "withdraw", "USDC", "421614", "--amount", "10"],
        vec!["orderly", "batch-order-cancel", "1", "2", "3"],
    ];
    for args in cases {
        assert!(
            Cli::try_parse_from(&args).is_ok(),
            "failed to parse {args:?}"
        );
    }
}

#[test]
fn global_flags_accepted_after_subcommand() {
    let cli = Cli::try_parse_from([
        "orderly",
        "market-price",
        "PERP_ETH_USDC",
        "--csv",
        "--pretty",
        "--network",
        "mainnet",
    ])
    .unwrap();
    assert!(cli.csv);
    assert!(cli.pretty);
    assert_eq!(cli.network.as_deref(), Some("mainnet"));
}

#[test]
fn help_output_matches_typescript() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("parity/fixtures/help.txt");
    let expected = std::fs::read_to_string(&path)
        .expect("run `node rust/parity/gen_help_fixture.mjs` to generate the fixture");
    assert_eq!(
        orderly::help::full_help(),
        expected,
        "`orderly --help` differs from the TypeScript output"
    );
}
