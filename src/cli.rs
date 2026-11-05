//! Command-line surface definition (clap derive), mirroring `src/index.ts`.
//!
//! Every subcommand from the TypeScript CLI is represented here with the same
//! kebab-case name, positional arguments and flags. `--network`, `--csv` and
//! `--pretty` are global and therefore accepted on every subcommand.

use crate::config::get_default_network;
use crate::error::{AppError, OutputError};
use crate::output::OutputFormat;
use crate::types::Network;
use clap::{Args, Parser, Subcommand};

/// Global options plus the selected subcommand.
#[derive(Parser, Debug)]
#[command(
    name = "orderly",
    version,
    about = "Orderly Network CLI",
    disable_help_subcommand = true,
    propagate_version = true
)]
pub struct Cli {
    /// Network: mainnet or testnet
    #[arg(long, global = true, value_name = "network")]
    pub network: Option<String>,

    /// Output as CSV instead of JSON (for list data)
    #[arg(long, global = true)]
    pub csv: bool,

    /// Pretty-print JSON output (2-space indent)
    #[arg(long, global = true)]
    pub pretty: bool,

    #[command(subcommand)]
    pub command: CliCommand,
}

/// Resolved per-invocation context (network + output format).
#[derive(Debug, Clone, Copy)]
pub struct Ctx {
    pub network: Network,
    pub format: OutputFormat,
}

impl Ctx {
    pub fn from_cli(cli: &Cli) -> Result<Ctx, AppError> {
        let network = match &cli.network {
            Some(n) => Network::parse(n).ok_or_else(|| {
                AppError::User(OutputError::with_hints(
                    format!("Invalid network: \"{n}\". Use mainnet or testnet."),
                    vec![
                        "Example: orderly market-price PERP_ETH_USDC --network testnet".to_string(),
                    ],
                ))
            })?,
            None => get_default_network(),
        };
        Ok(Ctx {
            network,
            format: if cli.csv {
                OutputFormat::Csv
            } else {
                OutputFormat::Json
            },
        })
    }

    pub fn is_csv(&self) -> bool {
        matches!(self.format, OutputFormat::Csv)
    }
}

/// `--account <id>` (auto-resolves if a single account is stored).
#[derive(Args, Debug, Clone)]
pub struct AccountArgs {
    /// Account ID (auto-resolves if single account)
    #[arg(long, value_name = "id")]
    pub account: Option<String>,
}

// ---------------------------------------------------------------------------
// Argument structs
// ---------------------------------------------------------------------------

#[derive(Args, Debug)]
pub struct WalletCreateArgs {
    /// Wallet type: EVM or SOL (required in non-interactive mode)
    #[arg(long = "type", value_name = "type")]
    pub type_: Option<String>,
}

#[derive(Args, Debug)]
pub struct WalletImportArgs {
    /// Private key (positional)
    #[arg(value_name = "private-key")]
    pub private_key: Option<String>,

    /// Wallet type: EVM or SOL (required in non-interactive mode)
    #[arg(long = "type", value_name = "type")]
    pub type_: Option<String>,

    /// Wallet address (optional, derived from key)
    #[arg(long, value_name = "address")]
    pub address: Option<String>,

    /// Private key (alternative to positional arg, for non-interactive use)
    #[arg(long = "private-key", value_name = "key")]
    pub private_key_flag: Option<String>,
}

#[derive(Args, Debug)]
pub struct AddressOnlyArgs {
    /// Wallet address
    #[arg(value_name = "address")]
    pub address: Option<String>,
}

#[derive(Args, Debug)]
pub struct WalletRemoveArgs {
    /// Wallet address
    #[arg(value_name = "address")]
    pub address: Option<String>,

    /// Skip confirmation prompt (required in non-interactive mode)
    #[arg(long)]
    pub force: bool,
}

#[derive(Args, Debug)]
pub struct WalletRegisterArgs {
    /// Broker ID, e.g., "demo" (required for AI/scripts, prompts if omitted)
    #[arg(long, value_name = "id")]
    pub broker_id: Option<String>,

    /// Wallet address (required for AI/scripts, prompts if omitted)
    #[arg(long, value_name = "address")]
    pub address: Option<String>,
}

#[derive(Args, Debug)]
pub struct WalletAddKeyArgs {
    /// Wallet address (required for AI/scripts, prompts if omitted)
    #[arg(long, value_name = "address")]
    pub address: Option<String>,

    /// Key scopes: read,trading,asset (default: read,trading)
    #[arg(long, value_name = "scope")]
    pub scope: Option<String>,

    /// Broker ID (required when no API key stored for wallet)
    #[arg(long, value_name = "id")]
    pub broker_id: Option<String>,
}

#[derive(Args, Debug)]
pub struct WalletRevokeKeyArgs {
    #[command(flatten)]
    pub acct: AccountArgs,

    /// Skip confirmation prompt (required in non-interactive mode)
    #[arg(long)]
    pub force: bool,
}

#[derive(Args, Debug)]
pub struct AuthImportArgs {
    /// Ed25519 private key (positional)
    #[arg(value_name = "private-key")]
    pub private_key: Option<String>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct AuthListArgs {
    /// Output only account IDs, one per line (for scripting/piping)
    #[arg(long)]
    pub ids: bool,
}

#[derive(Args, Debug)]
pub struct AuthShowArgs {
    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct AuthLogoutArgs {
    /// Account ID (positional)
    #[arg(value_name = "account-id")]
    pub account_id: Option<String>,
}

#[derive(Args, Debug)]
pub struct AccountLimitsArgs {
    /// Show limits for one symbol (includes base_imr, base_mmr, order rules)
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct AccountLiquidationsArgs {
    /// Filter by symbol
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    /// Page number (default: 1)
    #[arg(long, value_name = "n")]
    pub page: Option<i64>,

    /// Page size (default: 25)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct AccountOnlyArgs {
    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct OrderPlaceArgs {
    #[arg(value_name = "symbol")]
    pub symbol: String,

    #[arg(value_name = "side")]
    pub side: String,

    /// Order type (omitted for the short BID/ASK form)
    #[arg(value_name = "type")]
    pub type_: Option<String>,

    #[arg(value_name = "quantity")]
    pub quantity: Option<String>,

    /// Order price (required for LIMIT, IOC, FOK, POST_ONLY)
    #[arg(long, value_name = "price")]
    pub price: Option<String>,

    /// Custom client order ID (optional)
    #[arg(long, value_name = "id")]
    pub client_order_id: Option<String>,

    /// Reduce-only order (can only reduce existing position, not open new)
    #[arg(long)]
    pub reduce_only: bool,

    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct OrderCancelArgs {
    #[arg(value_name = "order-id")]
    pub order_id: String,

    /// Symbol of the order (auto-fetched if not provided)
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct OrderIdSymbolArgs {
    #[arg(value_name = "order-id")]
    pub order_id: String,

    /// Symbol of the order (auto-fetched if not provided)
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct OrderEditArgs {
    #[arg(value_name = "order-id")]
    pub order_id: String,

    /// Symbol of the order (auto-fetched if not provided)
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    /// New order price
    #[arg(long, value_name = "price")]
    pub price: Option<String>,

    /// New order quantity
    #[arg(long, value_name = "quantity")]
    pub quantity: Option<String>,

    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct OrderCancelAllArgs {
    /// Filter by symbol (optional)
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct OrderListArgs {
    /// Filter by symbol
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    /// Filter by status. Individual: NEW, FILLED, CANCELLED, PARTIAL_FILLED, REJECTED. Bundled: INCOMPLETE, COMPLETED. Default: INCOMPLETE
    #[arg(long, value_name = "status")]
    pub status: Option<String>,

    /// Filter by side: BUY, SELL
    #[arg(long, value_name = "side")]
    pub side: Option<String>,

    /// Filter by type: LIMIT, MARKET
    #[arg(long = "order-type", value_name = "type")]
    pub order_type: Option<String>,

    /// Sort: CREATED_TIME_ASC, CREATED_TIME_DESC, UPDATED_TIME_ASC, UPDATED_TIME_DESC
    #[arg(long = "sort-by", value_name = "sort")]
    pub sort_by: Option<String>,

    /// Page number (default: 1)
    #[arg(long, value_name = "n")]
    pub page: Option<i64>,

    /// Page size (default: 25, max: 500)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,

    /// Filter by product type: PERP or BINARY
    #[arg(long = "product-type", value_name = "type")]
    pub product_type: Option<String>,

    /// Show all orders (overrides default INCOMPLETE filter)
    #[arg(long)]
    pub all: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct BatchPlaceArgs {
    /// JSON array of orders, or a path to a JSON file
    #[arg(value_name = "orders")]
    pub orders: String,

    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct BatchCancelArgs {
    #[arg(value_name = "order-ids", num_args = 1.., required = true)]
    pub order_ids: Vec<String>,

    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct BatchCancelByClientIdArgs {
    #[arg(value_name = "client-order-ids", num_args = 1.., required = true)]
    pub client_order_ids: Vec<String>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct OrderGetArgs {
    #[arg(value_name = "order-id")]
    pub order_id: Option<String>,

    /// Explicitly look up by client order ID
    #[arg(long = "client-order-id", value_name = "id")]
    pub client_order_id: Option<String>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct ClientOrderIdSymbolArgs {
    #[arg(value_name = "client-order-id")]
    pub client_order_id: String,

    #[arg(value_name = "symbol")]
    pub symbol: String,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct PositionsCloseArgs {
    #[arg(value_name = "symbol")]
    pub symbol: String,

    /// Partial close quantity (default: full position)
    #[arg(long, value_name = "n")]
    pub quantity: Option<f64>,

    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct HistoryArgs {
    /// Filter by symbol
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    /// Start timestamp (Unix ms)
    #[arg(long = "start-time", value_name = "timestamp")]
    pub start_time: Option<i64>,

    /// End timestamp (Unix ms)
    #[arg(long = "end-time", value_name = "timestamp")]
    pub end_time: Option<i64>,

    /// Page number (default: 1)
    #[arg(long, value_name = "n")]
    pub page: Option<i64>,

    /// Page size (default: 25)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct PositionsListArgs {
    /// Filter by product type: PERP or BINARY
    #[arg(long = "product-type", value_name = "type")]
    pub product_type: Option<String>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct ProductHistoryArgs {
    /// Filter by symbol
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    /// Start timestamp (Unix ms)
    #[arg(long = "start-time", value_name = "timestamp")]
    pub start_time: Option<i64>,

    /// End timestamp (Unix ms)
    #[arg(long = "end-time", value_name = "timestamp")]
    pub end_time: Option<i64>,

    /// Page number (default: 1)
    #[arg(long, value_name = "n")]
    pub page: Option<i64>,

    /// Page size (default: 25)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,

    /// Filter by product type: PERP or BINARY
    #[arg(long = "product-type", value_name = "type")]
    pub product_type: Option<String>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct LeverageArgs {
    #[arg(value_name = "symbol")]
    pub symbol: String,

    #[arg(value_name = "value")]
    pub value: Option<f64>,

    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct AlgoOrderPlaceArgs {
    #[arg(value_name = "symbol")]
    pub symbol: String,

    #[arg(value_name = "side")]
    pub side: String,

    #[arg(value_name = "algoType")]
    pub algo_type: String,

    #[arg(value_name = "quantity")]
    pub quantity: String,

    /// Trigger price (required for STOP and BRACKET)
    #[arg(long = "trigger-price", value_name = "price")]
    pub trigger_price: Option<String>,

    /// Trailing callback rate: 1-15 for percentage, or 0.01-0.15 as decimal. Required for TRAILING_STOP
    #[arg(long = "callback-rate", value_name = "rate")]
    pub callback_rate: Option<String>,

    /// Order price (for limit orders)
    #[arg(long, value_name = "price")]
    pub price: Option<String>,

    /// Take-profit trigger price (for TP_SL/POSITIONAL_TP_SL/BRACKET)
    #[arg(long = "tp-trigger-price", value_name = "price")]
    pub tp_trigger_price: Option<String>,

    /// Take-profit order price (optional, MARKET if not set)
    #[arg(long = "tp-price", value_name = "price")]
    pub tp_price: Option<String>,

    /// Stop-loss trigger price (for TP_SL/POSITIONAL_TP_SL/BRACKET)
    #[arg(long = "sl-trigger-price", value_name = "price")]
    pub sl_trigger_price: Option<String>,

    /// Stop-loss order price (optional, MARKET if not set)
    #[arg(long = "sl-price", value_name = "price")]
    pub sl_price: Option<String>,

    /// Reduce-only order (can only reduce existing position, not open new)
    #[arg(long)]
    pub reduce_only: bool,

    /// Custom client order ID (optional)
    #[arg(long = "client-order-id", value_name = "id")]
    pub client_order_id: Option<String>,

    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct AlgoOrderEditArgs {
    #[arg(value_name = "order-id")]
    pub order_id: String,

    /// Symbol of the order (auto-fetched if not provided)
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    /// New order price
    #[arg(long, value_name = "price")]
    pub price: Option<String>,

    /// New order quantity
    #[arg(long, value_name = "quantity")]
    pub quantity: Option<String>,

    /// New trigger price
    #[arg(long = "trigger-price", value_name = "price")]
    pub trigger_price: Option<String>,

    /// New callback rate: 1-15 for percentage, or 0.01-0.15 as decimal
    #[arg(long = "callback-rate", value_name = "rate")]
    pub callback_rate: Option<String>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct AlgoOrderCancelAllArgs {
    /// Filter by symbol (optional)
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    /// Filter by algo type: STOP, TP_SL, TRAILING_STOP, BRACKET
    #[arg(long = "algo-type", value_name = "type")]
    pub algo_type: Option<String>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct AlgoOrderListArgs {
    /// Filter by symbol
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    /// Filter by status. Default: INCOMPLETE
    #[arg(long, value_name = "status")]
    pub status: Option<String>,

    /// Show all orders (overrides default INCOMPLETE filter)
    #[arg(long)]
    pub all: bool,

    /// Filter by algo type: STOP, TP_SL, POSITIONAL_TP_SL, TRAILING_STOP, BRACKET
    #[arg(long = "algo-type", value_name = "type")]
    pub algo_type: Option<String>,

    /// Page number (default: 1)
    #[arg(long, value_name = "n")]
    pub page: Option<i64>,

    /// Page size (default: 25, max: 500)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct SettlePnlHistoryArgs {
    /// Page number (default: 1)
    #[arg(long, value_name = "n")]
    pub page: Option<i64>,

    /// Page size (default: 25)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct DistributionHistoryArgs {
    /// Filter by status: CREATED, SPLIT, COMPLETED
    #[arg(long, value_name = "status")]
    pub status: Option<String>,

    /// Filter by type: BROKER_FEE, REFEREE_REBATE, REFERRER_REBATE
    #[arg(long = "type", value_name = "type")]
    pub type_: Option<String>,

    /// Start timestamp (Unix ms)
    #[arg(long = "start-time", value_name = "timestamp")]
    pub start_time: Option<i64>,

    /// End timestamp (Unix ms)
    #[arg(long = "end-time", value_name = "timestamp")]
    pub end_time: Option<i64>,

    /// Page number (default: 1)
    #[arg(long, value_name = "n")]
    pub page: Option<i64>,

    /// Page size (default: 25)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct NotificationInboxArgs {
    /// Filter by type: TRADE or SYSTEM
    #[arg(long = "type", value_name = "type")]
    pub type_: Option<String>,

    /// Page number (default: 1)
    #[arg(long, value_name = "n")]
    pub page: Option<i64>,

    /// Page size (default: 25)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct SymbolArgs {
    #[arg(value_name = "symbol")]
    pub symbol: String,
}

#[derive(Args, Debug)]
pub struct SymbolsArgs {
    /// Show detailed per-symbol order rules instead of compact list
    #[arg(long)]
    pub info: bool,
}

#[derive(Args, Debug)]
pub struct KlineArgs {
    #[arg(value_name = "symbol")]
    pub symbol: String,

    #[arg(value_name = "type")]
    pub type_: String,

    /// Number of candles (default: 100, max: 1000)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,
}

#[derive(Args, Debug)]
pub struct MarketTradesArgs {
    #[arg(value_name = "symbol")]
    pub symbol: String,

    /// Number of trades (default: 50)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,
}

#[derive(Args, Debug)]
pub struct MarketOrderbookArgs {
    #[arg(value_name = "symbol")]
    pub symbol: String,

    /// Number of price levels per side (default: all)
    #[arg(long, value_name = "n")]
    pub depth: Option<i64>,
}

#[derive(Args, Debug)]
pub struct OptionalSymbolArgs {
    /// Filter by symbol
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,
}

#[derive(Args, Debug)]
pub struct LiquidatedPositionsArgs {
    /// Filter by symbol
    #[arg(long, value_name = "symbol")]
    pub symbol: Option<String>,

    /// Page number (default: 1)
    #[arg(long, value_name = "n")]
    pub page: Option<i64>,

    /// Page size (default: 25)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,
}

#[derive(Args, Debug)]
pub struct FaucetArgs {
    #[arg(value_name = "address")]
    pub address: String,

    /// Required. EVM: 421614 (Arbitrum Sepolia), 84532 (Base Sepolia). SOL: 901901901 (Devnet)
    #[arg(long = "chain-id", value_name = "id")]
    pub chain_id: Option<String>,

    /// Broker ID (default: demo)
    #[arg(long, value_name = "id")]
    pub broker_id: Option<String>,
}

#[derive(Args, Debug)]
pub struct FaucetAccountArgs {
    /// Destination chain ID for EVM (default: 421614, Arbitrum Sepolia)
    #[arg(long = "chain-id", value_name = "id")]
    pub chain_id: Option<String>,

    /// Broker ID (auto-resolved from the account if omitted)
    #[arg(long, value_name = "id")]
    pub broker_id: Option<String>,

    /// Wait for the USDC to appear in the Orderly account balance
    #[arg(long)]
    pub wait: bool,

    /// Maximum seconds to wait for the balance (default: 120)
    #[arg(long, value_name = "seconds", default_value_t = 120)]
    pub timeout: u64,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct PredictRoundsArgs {
    /// Filter by status: ACTIVE, DELISTING, RECYCLING, DELISTED
    #[arg(long, value_name = "status")]
    pub status: Option<String>,

    /// Only show the round currently in its observation window
    #[arg(long)]
    pub current: bool,

    /// Maximum rows to print (default: 20, max: 300)
    #[arg(long, value_name = "n")]
    pub limit: Option<usize>,

    /// Print all rounds (overrides --limit)
    #[arg(long)]
    pub all: bool,
}

#[derive(Args, Debug)]
pub struct PredictRoundArgs {
    /// Round symbol (defaults to the current round)
    #[arg(value_name = "symbol")]
    pub symbol: Option<String>,
}

#[derive(Args, Debug)]
pub struct PredictOrderbookArgs {
    /// Round symbol (defaults to the current round)
    #[arg(value_name = "symbol")]
    pub symbol: Option<String>,

    /// Number of price levels per side (default: all)
    #[arg(long, value_name = "n")]
    pub depth: Option<i64>,
}

#[derive(Args, Debug)]
pub struct PredictOrderArgs {
    /// Round symbol
    #[arg(value_name = "symbol")]
    pub symbol: String,

    /// Direction: UP or DOWN
    #[arg(value_name = "direction")]
    pub direction: String,

    /// Number of shares
    #[arg(value_name = "shares")]
    pub shares: String,

    /// Limit price in the selected direction (0.01-0.99)
    #[arg(long, value_name = "price")]
    pub price: Option<String>,

    /// Order type: LIMIT, IOC, POST_ONLY (default: LIMIT)
    #[arg(long = "type", value_name = "type")]
    pub type_: Option<String>,

    /// Adjust a POST_ONLY price by one tick toward the best price
    #[arg(long = "post-only-adjust")]
    pub post_only_adjust: bool,

    /// Custom client order ID (optional)
    #[arg(long = "client-order-id", value_name = "id")]
    pub client_order_id: Option<String>,

    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct PredictCloseArgs {
    /// Round symbol
    #[arg(value_name = "symbol")]
    pub symbol: String,

    /// Shares to close (default: full position)
    #[arg(long, value_name = "n")]
    pub shares: Option<String>,

    /// Price protection in ticks (default: 2)
    #[arg(long = "protect-ticks", value_name = "n", default_value_t = 2)]
    pub protect_ticks: i64,

    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
#[allow(clippy::struct_field_names)]
pub struct BrokerCreateArgs {
    /// Desired broker ID
    #[arg(value_name = "broker-id")]
    pub broker_id: Option<String>,

    /// EVM wallet address (prompts if not provided)
    #[arg(long, value_name = "address")]
    pub address: Option<String>,

    /// Payment tx hash (skip info, go straight to verify)
    #[arg(long = "tx-hash", value_name = "hash")]
    pub tx_hash: Option<String>,

    /// Payment chain: ethereum, arbitrum, base
    #[arg(long, value_name = "chain")]
    pub chain: Option<String>,

    /// Chain ID: 1, 42161, 8453
    #[arg(long = "chain-id", value_name = "id")]
    pub chain_id: Option<i64>,

    /// Payment token: usdc, usdt, or order
    #[arg(long = "payment-type", value_name = "type")]
    pub payment_type: Option<String>,

    /// Maker fee in basis points (-0.5 to 15)
    #[arg(long = "maker-fee", value_name = "bps")]
    pub maker_fee: Option<f64>,

    /// Taker fee in basis points (3 to 15)
    #[arg(long = "taker-fee", value_name = "bps")]
    pub taker_fee: Option<f64>,

    /// RWA maker fee in basis points (-0.5 to 15)
    #[arg(long = "rwa-maker-fee", value_name = "bps")]
    pub rwa_maker_fee: Option<f64>,

    /// RWA taker fee in basis points (5 to 15)
    #[arg(long = "rwa-taker-fee", value_name = "bps")]
    pub rwa_taker_fee: Option<f64>,
}

#[derive(Args, Debug)]
pub struct BrokerStatusArgs {
    /// EVM wallet address (prompts if not provided)
    #[arg(long, value_name = "address")]
    pub address: Option<String>,
}

#[derive(Args, Debug)]
pub struct ChainsArgs {
    /// Filter chains by broker ID
    #[arg(long, value_name = "id")]
    pub broker_id: Option<String>,

    /// Include broker_ids array for each chain
    #[arg(long)]
    pub verbose: bool,
}

#[derive(Args, Debug)]
pub struct TokensArgs {
    /// Include chain_details array for each token
    #[arg(long)]
    pub verbose: bool,
}

#[derive(Args, Debug)]
pub struct DepositInfoArgs {
    #[arg(value_name = "token")]
    pub token: String,

    #[arg(value_name = "chain-id")]
    pub chain_id: i64,
}

#[derive(Args, Debug)]
pub struct WithdrawArgs {
    #[arg(value_name = "token")]
    pub token: String,

    #[arg(value_name = "chain-id")]
    pub chain_id: i64,

    /// Destination address (defaults to your wallet address)
    #[arg(long, value_name = "address")]
    pub receiver: Option<String>,

    /// Amount to withdraw (required, e.g. 10.5)
    #[arg(long, value_name = "amount")]
    pub amount: Option<String>,

    /// Amount is in smallest units (default: false, use human-readable like 10.5)
    #[arg(long)]
    pub raw: bool,

    /// Allow cross-chain withdrawal (required when destination chain differs from deposit chain)
    #[arg(long = "allow-cross-chain")]
    pub allow_cross_chain: bool,

    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct SettlePnlArgs {
    /// Print the request payload without signing or sending it
    #[arg(long)]
    pub dry_run: bool,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct AssetHistoryArgs {
    /// Filter by token
    #[arg(long, value_name = "token")]
    pub token: Option<String>,

    /// Filter by side: DEPOSIT or WITHDRAW
    #[arg(long, value_name = "side")]
    pub side: Option<String>,

    /// Filter by status: NEW, CONFIRM, PROCESSING, COMPLETED, FAILED, PENDING_REBALANCE
    #[arg(long, value_name = "status")]
    pub status: Option<String>,

    /// Page number (default: 1)
    #[arg(long, value_name = "n")]
    pub page: Option<i64>,

    /// Page size (default: 25)
    #[arg(long, value_name = "n")]
    pub size: Option<i64>,

    #[command(flatten)]
    pub acct: AccountArgs,
}

#[derive(Args, Debug)]
pub struct SchemaArgs {
    /// Machine-readable JSON manifest (default output)
    #[arg(long)]
    pub json: bool,
}

// ---------------------------------------------------------------------------
// Command tree
// ---------------------------------------------------------------------------

/// Every subcommand of the CLI.
#[derive(Subcommand, Debug)]
pub enum CliCommand {
    /// Create a new EVM or SOL wallet
    WalletCreate(WalletCreateArgs),
    /// Import an existing wallet private key
    WalletImport(WalletImportArgs),
    /// List all stored wallets
    WalletList,
    /// Show wallet info (address required for AI/scripts, prompts if omitted)
    WalletShow(AddressOnlyArgs),
    /// Remove wallet private key from keychain. WARNING: can cause permanent loss of access to dependent accounts.
    #[command(
        about = "Remove wallet private key from keychain. WARNING: can cause permanent loss of access to dependent accounts."
    )]
    WalletRemove(WalletRemoveArgs),
    /// Remove wallet from keychain (alias for wallet-remove)
    WalletLogout(AddressOnlyArgs),
    /// Register an Orderly account with your wallet (Step 2 of setup)
    WalletRegister(WalletRegisterArgs),
    /// Add Orderly API key for trading (Step 3 of setup)
    WalletAddKey(WalletAddKeyArgs),
    /// Revoke the current Orderly API key (server-side + local keychain removal)
    #[command(
        about = "Revoke the current Orderly API key (server-side + local keychain removal).\n\nWARNING: This permanently deactivates the key. You will lose ALL access\nto the account via this key. Use wallet-add-key to generate a new one after."
    )]
    WalletRevokeKey(WalletRevokeKeyArgs),

    /// Import existing Ed25519 API key (for users who already have one)
    AuthImport(AuthImportArgs),
    /// List all stored API keys (public keys only)
    AuthList(AuthListArgs),
    /// Show public key for an account
    AuthShow(AuthShowArgs),
    /// Remove API key from keychain
    AuthLogout(AuthLogoutArgs),
    /// Remove all stored API keys for a network
    AuthCleanup,
    /// Export Ed25519 private key (requires interactive TTY)
    AuthExportKey(AuthLogoutArgs),

    /// Get account information
    AccountInfo(AccountOnlyArgs),
    /// Get account balances
    AccountBalance(AccountOnlyArgs),
    /// Get account trading statistics (volume, fees, days since registration)
    AccountStatistics(AccountOnlyArgs),
    /// Get margin requirements and position limits
    #[command(
        about = "Get margin requirements and position limits.\n  imr_factor: per-symbol factor used in initial margin calculation — IMR_i = max(1/max_leverage, base_imr, imr_factor * |notional|^0.8)\n  max_notional: max position size in USD per symbol\n  base_imr / base_mmr: minimum initial/maintenance margin ratios (shown with --symbol)\n  base_mmr: threshold for liquidation — MMR_i = max(base_mmr, (base_mmr/base_imr) * imr_factor * |notional|^0.8)"
    )]
    AccountLimits(AccountLimitsArgs),
    /// Get registered API key info and scopes
    KeyInfo(AccountOnlyArgs),
    /// Get current fee rates (futures, RWA, default)
    #[command(
        long_about = "Get current fee rates (futures, RWA, predict, default).\n\nThe predict block reports binary_maker_fee_rate and binary_taker_fee_rate in bps."
    )]
    FeeTier(AccountOnlyArgs),
    /// Get account liquidation history
    AccountLiquidations(AccountLiquidationsArgs),

    /// Place a new order
    #[command(
        long_about = "Place a new perpetual-futures order.\n\nFor Orderly Predict rounds, use `predict-buy` or `predict-sell`; Predict requires margin_mode=ISOLATED and only accepts LIMIT, IOC and POST_ONLY."
    )]
    OrderPlace(OrderPlaceArgs),
    /// Cancel an order
    OrderCancel(OrderCancelArgs),
    /// Edit a pending order (only specify what to change)
    OrderEdit(OrderEditArgs),
    /// Cancel all orders
    OrderCancelAll(OrderCancelAllArgs),
    /// List orders (defaults to open/active orders)
    OrderList(OrderListArgs),
    /// Place multiple orders (max 10)
    BatchOrderPlace(BatchPlaceArgs),
    /// Cancel multiple orders by IDs
    BatchOrderCancel(BatchCancelArgs),
    /// Cancel multiple orders by client order IDs (max 10)
    BatchOrderCancelByClientId(BatchCancelByClientIdArgs),
    /// Get order details. Auto-detects numeric order ID vs client order ID
    OrderGet(OrderGetArgs),
    /// Cancel an order by client order ID
    OrderCancelByClientId(ClientOrderIdSymbolArgs),
    /// Get trades for a specific order
    OrderTrades(OrderIdSymbolArgs),

    /// Place an algo order
    #[command(
        about = "Place an algo order.\n\nValid algoTypes and their required flags:\n  STOP             --trigger-price\n  TP_SL            --tp-trigger-price and/or --sl-trigger-price\n  POSITIONAL_TP_SL --tp-trigger-price and/or --sl-trigger-price (quantity must be 0)\n  TRAILING_STOP    --callback-rate (1-15%)\n  BRACKET          --trigger-price + --tp-trigger-price and/or --sl-trigger-price\n\nValid sides: BUY, SELL"
    )]
    AlgoOrderPlace(AlgoOrderPlaceArgs),
    /// Cancel an algo order
    AlgoOrderCancel(OrderCancelArgs),
    /// Edit a pending algo order (only specify what to change)
    #[command(
        about = "Edit a pending algo order (only specify what to change: price, quantity, trigger-price, callback-rate)"
    )]
    AlgoOrderEdit(AlgoOrderEditArgs),
    /// Cancel all algo orders
    AlgoOrderCancelAll(AlgoOrderCancelAllArgs),
    /// List algo orders (defaults to open/active orders)
    AlgoOrderList(AlgoOrderListArgs),
    /// Get trades for a specific algo order
    AlgoOrderTrades(OrderIdSymbolArgs),
    /// Get details for a specific algo order
    AlgoOrderGet(OrderIdSymbolArgs),
    /// Cancel an algo order by client order ID
    AlgoOrderCancelByClientId(ClientOrderIdSymbolArgs),

    /// List open positions
    #[command(
        long_about = "List open positions.\n\nFor Orderly Predict positions, position_qty > 0 is UP and position_qty < 0 is DOWN; margin_mode is always ISOLATED. Use --product-type BINARY to show Predict positions only."
    )]
    PositionsList(PositionsListArgs),
    /// Close a position
    #[command(
        long_about = "Close a position with a reduce-only MARKET order.\n\nMARKET orders are not supported for Orderly Predict rounds. Use `orderly predict-close <symbol>` for Predict positions."
    )]
    PositionsClose(PositionsCloseArgs),
    /// Get position history
    #[command(
        long_about = "Get position history.\n\nFor Orderly Predict positions, settlement rows include outcome, settlement_price_per_share and settled_at. Use --product-type BINARY to filter."
    )]
    PositionsHistory(ProductHistoryArgs),

    /// Get or set leverage for a symbol
    Leverage(LeverageArgs),
    /// Get trade history
    #[command(
        long_about = "Get trade history.\n\nFor Orderly Predict fills, fee is the per-fill fee in USDC; expiry settlements appear at price 0, 0.5 or 1. Use --product-type BINARY to filter."
    )]
    Trades(ProductHistoryArgs),
    /// Get funding fee history
    FundingHistory(HistoryArgs),

    /// Get current market price
    MarketPrice(SymbolArgs),
    /// Get orderbook snapshot
    MarketOrderbook(MarketOrderbookArgs),
    /// Get recent public trades
    MarketTrades(MarketTradesArgs),
    /// List trading symbols
    #[command(
        about = "List trading symbols. Default: compact list (symbol, pair, prices). Use --info for full order rules (lot size, min notional, price tick, etc.)"
    )]
    Symbols(SymbolsArgs),
    /// Get candlestick/kline data
    #[command(
        about = "Get candlestick/kline data. Valid intervals: 1m, 5m, 15m, 30m, 1h, 4h, 12h, 1d, 1w, 1mon"
    )]
    Kline(KlineArgs),
    /// Get public funding rates for all symbols (no auth required)
    FundingRates(OptionalSymbolArgs),
    /// Get price changes for all symbols (no auth required)
    #[command(
        about = "Get price changes for all symbols (5m, 30m, 1h, 24h, 7d, 30d) (no auth required)"
    )]
    PriceChanges(OptionalSymbolArgs),
    /// Get long/short open interest for all symbols (no auth required)
    OpenInterest(OptionalSymbolArgs),
    /// Get public liquidated positions (no auth required)
    LiquidatedPositions(LiquidatedPositionsArgs),
    /// Get Orderly system maintenance status (no auth required)
    SystemStatus,

    /// List Orderly Predict rounds (5-minute BTC Up/Down)
    PredictRounds(PredictRoundsArgs),
    /// Show a Predict round (defaults to the current round)
    PredictRound(PredictRoundArgs),
    /// Show the UP and DOWN order books for a Predict round
    #[command(
        long_about = "Show the UP and DOWN order books for an Orderly Predict round.\n\nUse down_asks to buy DOWN and down_bids to sell DOWN. The best object summarizes all four sides. Defaults to the current round."
    )]
    PredictOrderbook(PredictOrderbookArgs),
    /// Buy UP or DOWN shares in a Predict round
    #[command(
        long_about = "Buy UP or DOWN shares in an Orderly Predict round.\n\n--price is in the selected direction. DOWN buys are sent to the UP book as SELL orders at 1 - price. Only LIMIT, IOC and POST_ONLY are supported; margin_mode is always ISOLATED. The minimum notional is checked against the UP-book price."
    )]
    PredictBuy(PredictOrderArgs),
    /// Sell (reduce) an existing Predict position
    #[command(
        long_about = "Sell (reduce) an existing UP or DOWN Orderly Predict position.\n\nThe order is always reduce_only. --price is in the selected direction. DOWN sells are sent to the UP book as BUY orders at 1 - price."
    )]
    PredictSell(PredictOrderArgs),
    /// Close (part of) a Predict position with a protected IOC order
    #[command(
        long_about = "Close (part of) an Orderly Predict position with an IOC reduce-only order.\n\nBy default the protection price is 2 ticks beyond the best bid/ask. Use --shares for a partial close; the default is the full position."
    )]
    PredictClose(PredictCloseArgs),

    /// Get test USDC from faucet (testnet only)
    FaucetUsdc(FaucetArgs),
    /// Request testnet USDC for a stored Orderly account
    #[command(
        long_about = "Request testnet USDC for a stored Orderly account.\n\nResolves the wallet address and broker ID from the stored account, calls the testnet operator faucet, and optionally waits for the USDC to appear in the Orderly account balance. Requires an API key with read scope for the balance check."
    )]
    FaucetAccount(FaucetAccountArgs),

    /// Create a broker ID via Orderly One
    BrokerCreate(BrokerCreateArgs),
    /// Show your DEX/broker status (requires EVM wallet)
    BrokerStatus(BrokerStatusArgs),

    /// List supported chains (no auth required)
    Chains(ChainsArgs),
    /// List supported tokens (no auth required)
    Tokens(TokensArgs),
    /// Get deposit info for a token
    DepositInfo(DepositInfoArgs),
    /// Withdraw tokens (auto-signs with wallet key)
    #[command(
        about = "Withdraw tokens (auto-signs with wallet key). Omit --receiver to withdraw to your own wallet address."
    )]
    Withdraw(WithdrawArgs),
    /// Get asset deposit/withdraw history
    AssetHistory(AssetHistoryArgs),

    /// Settle unrealized PnL into account balance
    SettlePnl(SettlePnlArgs),
    /// Get on-chain PnL settlement history
    SettlePnlHistory(SettlePnlHistoryArgs),
    /// Get referral information (referrer/referee stats and codes)
    ReferralInfo(AccountOnlyArgs),
    /// Get broker fee and referral rebate history
    DistributionHistory(DistributionHistoryArgs),
    /// Get perp trading volume statistics
    #[command(about = "Get perp trading volume statistics (today, 1d, 7d, 30d, YTD, LTD)")]
    VolumeStats(AccountOnlyArgs),
    /// List notification inbox messages
    NotificationInbox(NotificationInboxArgs),
    /// Get unread notification count and messages
    NotificationUnread(AccountOnlyArgs),

    /// Print a machine-readable manifest of the entire CLI surface
    Schema(SchemaArgs),
}
