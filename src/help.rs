//! Top-level help text, mirroring the `DESCRIPTION` / `QUICK_START` blocks in
//! `src/index.ts` byte-for-byte (colours are only emitted on a TTY).

use crate::colors;

pub fn version_line() -> String {
    format!("orderly/{}", env!("CARGO_PKG_VERSION"))
}

/// TypeScript registration order (from `src/index.ts`), which is the order cac
/// prints commands in.
const ORDER: &[&str] = &[
    "schema",
    "wallet-create",
    "wallet-import",
    "wallet-list",
    "wallet-show",
    "wallet-remove",
    "wallet-logout",
    "wallet-register",
    "wallet-add-key",
    "wallet-revoke-key",
    "auth-import",
    "auth-list",
    "auth-show",
    "auth-logout",
    "auth-cleanup",
    "auth-export-key",
    "account-info",
    "account-balance",
    "account-statistics",
    "account-limits",
    "key-info",
    "fee-tier",
    "account-liquidations",
    "order-place",
    "order-cancel",
    "order-edit",
    "order-cancel-all",
    "order-list",
    "batch-order-place",
    "batch-order-cancel",
    "batch-order-cancel-by-client-id",
    "order-get",
    "order-cancel-by-client-id",
    "order-trades",
    "positions-list",
    "positions-close",
    "market-orderbook",
    "positions-history",
    "leverage",
    "trades",
    "algo-order-place",
    "algo-order-cancel",
    "algo-order-edit",
    "algo-order-cancel-all",
    "algo-order-list",
    "algo-order-trades",
    "algo-order-get",
    "algo-order-cancel-by-client-id",
    "funding-history",
    "settle-pnl",
    "settle-pnl-history",
    "referral-info",
    "distribution-history",
    "volume-stats",
    "notification-inbox",
    "notification-unread",
    "market-price",
    "symbols",
    "kline",
    "market-trades",
    "funding-rates",
    "price-changes",
    "open-interest",
    "liquidated-positions",
    "system-status",
    "faucet-usdc",
    "broker-create",
    "broker-status",
    "chains",
    "tokens",
    "deposit-info",
    "withdraw",
    "asset-history",
];

fn arg_spec_name(id: &str) -> String {
    match id {
        "type_" => "type".to_string(),
        "algo_type" => "algoType".to_string(),
        other => other.replace('_', "-").trim_end_matches('-').to_string(),
    }
}

/// Display-only usage overrides where cac's declared usage differs from the
/// parseable clap tree (e.g. `order-place`'s `[type]` short form still declares
/// `<quantity>` as required).
fn spec_override(name: &str) -> Option<&'static str> {
    match name {
        "order-place" => Some("order-place <symbol> <side> [type] <quantity>"),
        _ => None,
    }
}

/// The cac-style usage spec for a subcommand: its name followed by positional
/// arguments (`<required>`, `[optional]`, `<...variadic>`).
fn spec_for(sc: &clap::Command) -> String {
    let name = sc.get_name().to_string();
    if let Some(overridden) = spec_override(&name) {
        return overridden.to_string();
    }
    let mut spec = name;
    for a in sc.get_arguments() {
        if a.get_long().is_some() || a.get_short().is_some() {
            continue;
        }
        if a.get_id() == "help" || a.get_id() == "version" {
            continue;
        }
        let id = arg_spec_name(a.get_id().as_str());
        let variadic = a
            .get_num_args()
            .map(|r| r.max_values() > 1)
            .unwrap_or(false);
        if variadic {
            spec.push_str(&format!(" <...{id}>"));
        } else if a.is_required_set() {
            spec.push_str(&format!(" <{id}>"));
        } else {
            spec.push_str(&format!(" [{id}]"));
        }
    }
    spec
}

/// The usage spec for a named subcommand, used by the "missing required args"
/// diagnostic to match the TypeScript CLI's message.
pub fn usage_spec(name: &str) -> Option<String> {
    use clap::CommandFactory;
    let cmd = crate::cli::Cli::command();
    for sc in cmd.get_subcommands() {
        if sc.get_name() == name {
            return Some(spec_for(sc));
        }
    }
    None
}

/// Reproduces cac's `Commands:` list (name + positional spec, aligned, then the
/// command description) from the clap command tree, in TS registration order.
pub fn command_list() -> String {
    use clap::CommandFactory;
    let cmd = crate::cli::Cli::command();
    const WIDTH: usize = 59;

    let mut rows: Vec<(usize, String, String)> = Vec::new();
    for sc in cmd.get_subcommands() {
        let name = sc.get_name().to_string();
        let rank = ORDER.iter().position(|n| *n == name).unwrap_or(usize::MAX);
        let about = sc.get_about().map(|s| s.to_string()).unwrap_or_default();
        rows.push((rank, spec_for(sc), about));
    }
    rows.sort_by_key(|(rank, _, _)| *rank);

    let mut out = String::new();
    for (_, spec, about) in rows {
        out.push_str(&format!("  {spec:<WIDTH$}{about}\n"));
    }
    out
}

/// cac's trailing "For more info, run any command with the `--help` flag" block.
pub fn hints_block() -> String {
    let mut out = String::new();
    for name in ORDER {
        out.push_str(&format!("  $ orderly {name} --help\n"));
    }
    out
}

/// The complete `orderly --help` output.
pub fn full_help() -> String {
    let mut out = top_level_help();
    out.push_str(&version_line());
    out.push('\n');
    out.push_str("\nUsage:\n  $ orderly <command> [options]\n\nCommands:\n");
    out.push_str(&command_list());
    out.push_str("\nFor more info, run any command with the `--help` flag:\n");
    out.push_str(&hints_block());
    out.push_str("\nOptions:\n");
    out.push_str("  -v, --version        Display version number \n");
    out.push_str("  -h, --help           Display this message \n");
    out.push_str("  --network <network>  Network: mainnet or testnet (default: testnet)\n");
    out.push_str("  --csv                Output as CSV instead of JSON (for list data) \n");
    out.push_str("  --pretty             Pretty-print JSON output (2-space indent) \n");
    out
}

fn rule() -> String {
    colors::dim(&"\u{2500}".repeat(50))
}

/// Printed for `orderly`, `orderly --help`, `orderly -h` and `orderly help`.
pub fn top_level_help() -> String {
    let mut out = String::new();

    // --- DESCRIPTION -------------------------------------------------------
    out.push('\n');
    out.push_str(&colors::bold("Orderly Network CLI"));
    out.push('\n');
    out.push_str(&colors::dim(
        "Secure keychain-based trading CLI for Orderly Network",
    ));
    out.push('\n');
    out.push_str(
        "\nThis CLI uses your OS keychain (Keychain/Credential Manager/libsecret) to store\nprivate keys securely. Keys are NEVER exposed to AI context or logged.\n",
    );
    out.push('\n');
    out.push_str(&colors::cyan_bold("SETUP FLOW"));
    out.push('\n');
    out.push_str(&rule());
    out.push('\n');
    out.push('\n');
    out.push_str(&colors::yellow("For new users:"));
    out.push_str("\n  wallet-create    \u{2192} Generate a new wallet (EVM or SOL)\n  wallet-register  \u{2192} Register wallet with Orderly (get account ID)\n  wallet-add-key   \u{2192} Generate & register Ed25519 API key for trading\n");
    out.push('\n');
    out.push_str(&colors::yellow("For existing Orderly users with API keys:"));
    out.push_str("\n  auth-import      \u{2192} Import existing Ed25519 API key directly\n");
    out.push('\n');
    out.push_str(&colors::cyan_bold("COMMANDS BY CATEGORY"));
    out.push('\n');
    out.push_str(&rule());
    out.push('\n');
    out.push('\n');
    out.push_str(&colors::yellow("Setup & Auth:"));
    out.push_str("\n  wallet-create, wallet-import, wallet-list, wallet-show, wallet-remove\n  wallet-register, wallet-add-key, wallet-revoke-key\n  auth-import, auth-list, auth-show, auth-logout, auth-cleanup, auth-export-key\n");
    out.push('\n');
    out.push_str(&colors::yellow("Trading:"));
    out.push_str("\n  order-place, order-cancel, order-edit, order-cancel-all, order-list\n  order-get, order-cancel-by-client-id, order-trades\n  batch-order-place, batch-order-cancel, batch-order-cancel-by-client-id\n  algo-order-place, algo-order-cancel, algo-order-cancel-all, algo-order-edit, algo-order-list, algo-order-trades, algo-order-get, algo-order-cancel-by-client-id\n  positions-list, positions-close, positions-history\n  leverage, trades, funding-history\n");
    out.push('\n');
    out.push_str(&colors::yellow("Account:"));
    out.push_str("\n  account-info, account-balance, account-statistics, account-limits\n  key-info, fee-tier, account-liquidations\n");
    out.push('\n');
    out.push_str(&colors::yellow("Market Data:"));
    out.push_str("\n  market-price, market-orderbook, market-trades, funding-rates, kline, symbols\n  price-changes, open-interest, liquidated-positions, system-status\n");
    out.push('\n');
    out.push_str(&colors::yellow("Assets:"));
    out.push_str("\n  chains, tokens, deposit-info, withdraw, asset-history\n");
    out.push('\n');
    out.push_str(&colors::yellow("PnL:"));
    out.push_str("\n  settle-pnl, settle-pnl-history\n");
    out.push('\n');
    out.push_str(&colors::yellow("Referral:"));
    out.push_str("\n  referral-info\n");
    out.push('\n');
    out.push_str(&colors::yellow("Stats & Notifications:"));
    out.push_str(
        "\n  distribution-history, volume-stats, notification-inbox, notification-unread\n",
    );
    out.push('\n');
    out.push_str(&colors::yellow("Testnet Only:"));
    out.push_str("\n  faucet-usdc\n");
    out.push('\n');
    out.push_str(&colors::yellow("Orderly One:"));
    out.push_str("\n  broker-create\n");

    // --- QUICK_START -------------------------------------------------------
    out.push('\n');
    out.push('\n');
    out.push_str(&colors::cyan_bold("QUICK START (Testnet)"));
    out.push('\n');
    out.push_str(&rule());
    out.push_str("\n\n1. Create a new wallet:\n   ");
    out.push_str(&colors::green("orderly wallet-create --type EVM"));
    out.push_str("\n\n2. Register an Orderly account:\n   ");
    out.push_str(&colors::green("orderly wallet-register --broker-id demo"));
    out.push_str("\n\n3. Get test USDC (wait a few minutes for delivery):\n   ");
    out.push_str(&colors::green(
        "orderly faucet-usdc <address> --chain-id 421614",
    ));
    out.push_str("\n\n4. Add API key for trading:\n   ");
    out.push_str(&colors::green("orderly wallet-add-key"));
    out.push_str("\n\n5. Check balance:\n   ");
    out.push_str(&colors::green("orderly account-balance"));
    out.push_str("\n\n6. Place an order:\n   ");
    out.push_str(&colors::green(
        "orderly order-place PERP_ETH_USDC BUY MARKET 0.01",
    ));
    out.push('\n');

    // --- Global options + footer -------------------------------------------
    out.push('\n');
    out.push_str(&colors::bold("Global Options:"));
    out.push('\n');
    out.push_str(&colors::dim(
        "  --network <network>  Network: mainnet or testnet (default: testnet)",
    ));
    out.push('\n');
    out.push_str(&colors::dim(
        "  --pretty             Pretty-print JSON output (2-space indent)",
    ));
    out.push('\n');
    out.push_str(&colors::dim(
        "  --csv                Output as CSV instead of JSON (for list data)",
    ));
    out.push('\n');
    out.push('\n');
    out.push_str(&colors::dim("Run any command with --help for more details"));
    out.push('\n');
    out.push_str(&colors::cyan("  orderly wallet-create --help"));
    out.push('\n');
    out.push_str(&colors::cyan("  orderly order-place --help"));
    out.push('\n');

    out
}
