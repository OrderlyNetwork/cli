//! `orderly schema` — a machine-readable manifest of the clap command surface.
//!
//! The manifest is derived from `Cli::command()` so it can never drift from the
//! real parser. `mutates` is the single hand-maintained piece of information:
//! it marks commands that change server (or keychain) state.

use crate::cli::Cli;
use crate::error::AppError;
use clap::{Arg, Command, CommandFactory};
use serde_json::{json, Value};

/// Commands that change state. Everything else is read-only.
///
/// Auditable on purpose: one flat list of clap command names. `leverage` is
/// listed because `--value` sets leverage (without it the command only reads).
pub const MUTATING_COMMANDS: &[&str] = &[
    // orders
    "order-place",
    "order-cancel",
    "order-edit",
    "order-cancel-all",
    "order-cancel-by-client-id",
    "batch-order-place",
    "batch-order-cancel",
    "batch-order-cancel-by-client-id",
    // algo orders
    "algo-order-place",
    "algo-order-cancel",
    "algo-order-edit",
    "algo-order-cancel-all",
    "algo-order-cancel-by-client-id",
    // positions / account
    "positions-close",
    "leverage",
    "settle-pnl",
    // funds
    "withdraw",
    "faucet-usdc",
    // wallets / auth / broker (server or keychain mutations)
    "wallet-create",
    "wallet-import",
    "wallet-remove",
    "wallet-logout",
    "wallet-register",
    "wallet-add-key",
    "wallet-revoke-key",
    "auth-import",
    "auth-logout",
    "auth-cleanup",
    "broker-create",
];

/// True when the given command path mutates state.
pub fn mutates(path: &str) -> bool {
    MUTATING_COMMANDS.contains(&path)
}

fn help_of(arg: &Arg) -> Option<String> {
    arg.get_long_help()
        .or_else(|| arg.get_help())
        .map(|h| h.to_string())
}

/// Values for arguments the CLI validates as free-form strings, so clap exposes
/// no possible values. Only lists the command itself validates against live
/// here, keyed by (command path, argument id).
fn known_possible_values(path: &str, arg: &str) -> &'static [&'static str] {
    const SIDES: &[&str] = &["BUY", "SELL"];
    const ORDER_TYPES: &[&str] = &["LIMIT", "MARKET", "IOC", "FOK", "POST_ONLY", "ASK", "BID"];
    const ALGO_TYPES: &[&str] = &[
        "STOP",
        "TP_SL",
        "POSITIONAL_TP_SL",
        "TRAILING_STOP",
        "BRACKET",
    ];
    const WALLET_TYPES: &[&str] = &["EVM", "SOL"];
    const KLINE_INTERVALS: &[&str] = &[
        "1m", "5m", "15m", "30m", "1h", "4h", "12h", "1d", "1w", "1mon",
    ];

    match (path, arg) {
        ("order-place", "side") | ("order-list", "side") | ("algo-order-place", "side") => SIDES,
        ("order-place", "type_") | ("order-list", "order_type") => ORDER_TYPES,
        ("algo-order-place", "algo_type")
        | ("algo-order-cancel-all", "algo_type")
        | ("algo-order-list", "algo_type") => ALGO_TYPES,
        ("wallet-create", "type_") | ("wallet-import", "type_") => WALLET_TYPES,
        ("kline", "type_") => KLINE_INTERVALS,
        _ => &[],
    }
}

fn arg_json(arg: &Arg, path: &str) -> Value {
    let value_name = arg
        .get_value_names()
        .and_then(|names| names.first())
        .map(|n| n.to_string());
    let mut possible_values: Vec<Value> = arg
        .get_possible_values()
        .into_iter()
        .map(|v| Value::String(v.get_name().to_string()))
        .collect();
    if possible_values.is_empty() {
        possible_values = known_possible_values(path, arg.get_id().as_str())
            .iter()
            .map(|v| Value::String((*v).to_string()))
            .collect();
    }
    let default_value = arg
        .get_default_values()
        .first()
        .map(|v| v.to_string_lossy().to_string());

    json!({
        "name": arg.get_id().to_string(),
        "long": arg.get_long(),
        "short": arg.get_short().map(|c| c.to_string()),
        "valueName": value_name,
        "required": arg.is_required_set(),
        "takesValue": arg.get_action().takes_values(),
        "possibleValues": possible_values,
        "defaultValue": default_value,
        "help": help_of(arg),
    })
}

/// Arguments clap injects or propagates globally; not part of a command's own
/// surface (they are listed once in `globalArgs`).
fn is_noise(arg: &Arg, global_ids: &[String]) -> bool {
    matches!(arg.get_id().as_str(), "help" | "version")
        || global_ids.iter().any(|id| id == arg.get_id().as_str())
}

fn collect_args(cmd: &Command, path: &str, global_ids: &[String]) -> Vec<Value> {
    cmd.get_arguments()
        .filter(|a| !is_noise(a, global_ids))
        .map(|a| arg_json(a, path))
        .collect()
}

fn command_json(cmd: &Command, path: &str, global_ids: &[String]) -> Value {
    let subcommands: Vec<Value> = cmd
        .get_subcommands()
        .filter(|c| !c.is_hide_set())
        .map(|c| {
            let child_path = format!("{path} {}", c.get_name());
            command_json(c, &child_path, global_ids)
        })
        .collect();

    json!({
        "path": path,
        "about": cmd.get_about().map(|s| s.to_string()),
        "mutates": mutates(path),
        "args": collect_args(cmd, path, global_ids),
        "subcommands": subcommands,
    })
}

/// Build the full manifest. `commands` mirrors the clap tree, one entry per
/// top-level subcommand (with nested `subcommands` if the tree ever nests).
pub fn build_manifest() -> Value {
    let cmd = Cli::command();
    let global_ids: Vec<String> = cmd
        .get_arguments()
        .map(|a| a.get_id().to_string())
        .collect();

    let global_args: Vec<Value> = cmd
        .get_arguments()
        .filter(|a| !matches!(a.get_id().as_str(), "help" | "version"))
        .map(|a| arg_json(a, ""))
        .collect();

    let commands: Vec<Value> = cmd
        .get_subcommands()
        .filter(|c| !c.is_hide_set())
        .map(|c| command_json(c, c.get_name(), &global_ids))
        .collect();

    json!({
        "name": cmd.get_name(),
        "version": env!("CARGO_PKG_VERSION"),
        "description": cmd.get_about().map(|s| s.to_string()),
        "globalArgs": global_args,
        "commands": commands,
    })
}

/// Print the manifest to stdout (compact JSON unless `--pretty`).
pub fn emit() -> Result<(), AppError> {
    let manifest = build_manifest();
    let text = if crate::output::is_pretty_json() {
        serde_json::to_string_pretty(&manifest)
    } else {
        serde_json::to_string(&manifest)
    }
    .map_err(|e| AppError::Msg(e.to_string()))?;
    println!("{text}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_mutating_entry_exists_and_schema_is_read_only() {
        let manifest = build_manifest();
        let paths: Vec<&str> = manifest
            .get("commands")
            .and_then(|c| c.as_array())
            .unwrap()
            .iter()
            .filter_map(|c| c.get("path").and_then(|p| p.as_str()))
            .collect();
        for name in MUTATING_COMMANDS {
            assert!(paths.contains(name), "unknown mutating command: {name}");
        }
        assert!(!mutates("schema"));
    }
}
