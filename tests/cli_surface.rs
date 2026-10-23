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
    "schema",
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

    assert_eq!(got.len(), 73, "expected 73 subcommands, got {}", got.len());
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
fn schema_manifest_describes_the_command_surface() {
    let manifest = orderly::commands::schema::build_manifest();
    let json = serde_json::to_string(&manifest).expect("manifest must serialize as JSON");
    assert!(json.starts_with('{'));

    let commands = manifest
        .get("commands")
        .and_then(|c| c.as_array())
        .expect("commands array");
    // The CLI surface is flat kebab-case, so the human form "order place" is
    // invoked as "order-place". Map it once, in the test, to keep both names
    // visible.
    let find = |human: &str| {
        let path = human.replace(' ', "-");
        commands
            .iter()
            .find(|c| c.get("path").and_then(|p| p.as_str()) == Some(path.as_str()))
            .unwrap_or_else(|| panic!("missing schema entry for {human} ({path})"))
    };

    let order_place = find("order place");
    let market_price = find("market price");
    assert_eq!(
        order_place.get("mutates").and_then(|m| m.as_bool()),
        Some(true)
    );
    assert_eq!(
        market_price.get("mutates").and_then(|m| m.as_bool()),
        Some(false)
    );

    let args = |cmd: &serde_json::Value| -> Vec<String> {
        cmd.get("args")
            .and_then(|a| a.as_array())
            .unwrap()
            .iter()
            .filter_map(|a| a.get("long").and_then(|l| l.as_str()).map(String::from))
            .collect()
    };
    let order_flags = args(order_place);
    for flag in ["price", "client-order-id", "reduce-only", "account"] {
        assert!(order_flags.contains(&flag.to_string()), "missing --{flag}");
    }

    let globals: Vec<String> = manifest
        .get("globalArgs")
        .and_then(|a| a.as_array())
        .unwrap()
        .iter()
        .filter_map(|a| a.get("long").and_then(|l| l.as_str()).map(String::from))
        .collect();
    assert!(globals.contains(&"network".to_string()));
    assert!(globals.contains(&"csv".to_string()));

    // Every arg exposes the documented keys, and clap's enum surface is a JSON array.
    for arg in order_place.get("args").and_then(|a| a.as_array()).unwrap() {
        assert!(arg.get("possibleValues").unwrap().is_array());
        assert!(arg.get("takesValue").unwrap().is_boolean());
    }

    // Boolean flags expose clap's true/false value parser; positionals take values.
    let reduce_only = order_place
        .get("args")
        .and_then(|a| a.as_array())
        .unwrap()
        .iter()
        .find(|a| a.get("long").and_then(|l| l.as_str()) == Some("reduce-only"))
        .expect("--reduce-only");
    assert_eq!(
        reduce_only.get("possibleValues").unwrap(),
        &serde_json::json!(["true", "false"])
    );
    assert_eq!(
        reduce_only.get("takesValue").and_then(|t| t.as_bool()),
        Some(false)
    );

    // Enums the CLI validates as free-form strings must still be enumerated, so
    // an agent can construct a valid order from the manifest alone.
    let possible = |cmd: &serde_json::Value, name: &str| -> Vec<String> {
        cmd.get("args")
            .and_then(|a| a.as_array())
            .unwrap()
            .iter()
            .find(|a| a.get("name").and_then(|n| n.as_str()) == Some(name))
            .and_then(|a| a.get("possibleValues"))
            .and_then(|v| v.as_array())
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    };
    assert_eq!(possible(order_place, "side"), vec!["BUY", "SELL"]);
    assert_eq!(
        possible(order_place, "type_"),
        vec!["LIMIT", "MARKET", "IOC", "FOK", "POST_ONLY", "ASK", "BID"]
    );
    assert_eq!(
        possible(find("algo order place"), "algo_type"),
        vec![
            "STOP",
            "TP_SL",
            "POSITIONAL_TP_SL",
            "TRAILING_STOP",
            "BRACKET"
        ]
    );
    assert_eq!(possible(find("wallet create"), "type_"), vec!["EVM", "SOL"]);
    assert_eq!(
        order_place.get("path").and_then(|p| p.as_str()),
        Some("order-place")
    );
    assert_eq!(
        find("schema").get("mutates").and_then(|m| m.as_bool()),
        Some(false)
    );
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

/// Keep every byte of the recorded fixture except the version banner, which
/// tracks `CARGO_PKG_VERSION` (the fixture was recorded at 1.2.0).
fn normalize_version_line(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        let is_version = trimmed.strip_prefix("orderly/").is_some_and(|rest| {
            !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit() || c == '.')
        });
        if is_version {
            let newline = if line.ends_with('\n') { "\n" } else { "" };
            out.push_str(&format!("orderly/{}{newline}", env!("CARGO_PKG_VERSION")));
        } else {
            out.push_str(line);
        }
    }
    out
}

#[test]
fn help_output_matches_typescript() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("parity/fixtures/help.txt");
    let expected =
        std::fs::read_to_string(&path).expect("missing parity fixture; see parity/README.md");

    // `schema` is a Rust-only command with no TypeScript equivalent, so it is
    // intentionally absent from the frozen parity fixture. Strip its two lines
    // before diffing and assert they were present, so the command cannot
    // silently disappear from `--help`.
    let current = orderly::help::full_help();
    let (current, removed) = strip_rust_only_help_additions(&current);
    assert_eq!(
        removed, 2,
        "expected `schema` command row and example row in `orderly --help`"
    );

    assert_eq!(
        current,
        normalize_version_line(&expected),
        "`orderly --help` differs from the TypeScript output"
    );
}

/// Remove the `schema` command row and its example line from the help text.
fn strip_rust_only_help_additions(text: &str) -> (String, usize) {
    let mut out = String::with_capacity(text.len());
    let mut removed = 0;

    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        let is_command_row = trimmed.starts_with("  schema ") && !trimmed.contains('$');
        let is_example_row = trimmed == "  $ orderly schema --help";

        if is_command_row || is_example_row {
            removed += 1;
            continue;
        }

        out.push_str(line);
    }

    (out, removed)
}
