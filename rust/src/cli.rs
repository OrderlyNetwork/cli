//! Command-line surface definition.

use clap::Parser;

/// Global options shared by every subcommand.
#[derive(Parser, Debug)]
#[command(
    name = "orderly",
    version,
    about = "Orderly Network CLI",
    disable_help_subcommand = true
)]
pub struct Cli {
    /// Network: mainnet or testnet
    #[arg(long, global = true, default_value = "testnet")]
    pub network: String,

    /// Output as CSV instead of JSON (for list data)
    #[arg(long, global = true)]
    pub csv: bool,

    /// Pretty-print JSON output (2-space indent)
    #[arg(long, global = true)]
    pub pretty: bool,
}
