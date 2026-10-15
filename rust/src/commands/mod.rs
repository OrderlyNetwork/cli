//! Command implementations, mirroring `src/commands/*.ts`.
//!
//! Each submodule corresponds to one file of the TypeScript CLI. Handlers return
//! `Err(AppError)` instead of calling `process::exit`, so `main` can funnel every
//! failure through `error::handle_error`.

use crate::error::{AppError, OutputError};

pub mod account;
pub mod algo;
pub mod assets;
pub mod auth;
pub mod broker;
pub mod faucet;
pub mod funding;
pub mod leverage;
pub mod market;
pub mod notification;
pub mod order;
pub mod positions;
pub mod referral;
pub mod settle;
pub mod stats;
pub mod trades;
pub mod wallet;

/// The hint the TS CLI prints whenever a symbol cannot be resolved.
pub const SYMBOL_HINT: &str = "Run `orderly symbols` to see available symbols.";

/// `error(message)` — a red user-facing error with no hints.
pub fn fail(message: impl Into<String>) -> AppError {
    AppError::User(OutputError::new(message))
}

/// `error(message, hints)` — a red user-facing error with dim hints.
pub fn fail_hints(message: impl Into<String>, hints: Vec<String>) -> AppError {
    AppError::User(OutputError::with_hints(message, hints))
}

/// JS `Number(str)` semantics for validation purposes.
pub fn js_number(value: &str) -> f64 {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

/// JS `String(number)` for interpolating numbers into messages.
pub fn js_num_str(value: f64) -> String {
    crate::output::js_f64_to_string(value)
}

/// Current Unix time in milliseconds (`Date.now()`).
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Interactive prompts (dialoguer)
// ---------------------------------------------------------------------------

pub mod prompt {
    use super::{fail, AppError};

    fn wrap(e: impl std::fmt::Display) -> AppError {
        fail(format!("Prompt failed: {e}"))
    }

    /// Select one of `items`; returns the chosen index.
    pub fn select(message: &str, items: &[String]) -> Result<usize, AppError> {
        dialoguer::Select::new()
            .with_prompt(message)
            .items(items)
            .interact()
            .map_err(wrap)
    }

    /// Free-text input.
    pub fn input(message: &str) -> Result<String, AppError> {
        dialoguer::Input::<String>::new()
            .with_prompt(message)
            .interact_text()
            .map_err(wrap)
    }

    /// Masked input for secrets.
    pub fn password(message: &str) -> Result<String, AppError> {
        dialoguer::Password::new()
            .with_prompt(message)
            .interact()
            .map_err(wrap)
    }

    /// Yes/no confirmation.
    pub fn confirm(message: &str, default: bool) -> Result<bool, AppError> {
        dialoguer::Confirm::new()
            .with_prompt(message)
            .default(default)
            .interact()
            .map_err(wrap)
    }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/// Route a parsed CLI invocation to its handler.
pub async fn dispatch(cli: crate::cli::Cli) -> Result<(), AppError> {
    use crate::cli::{CliCommand as C, Ctx};
    use crate::output::normalize_symbol;

    let ctx = Ctx::from_cli(&cli)?;

    match cli.command {
        C::WalletCreate(args) => wallet::wallet_create(args.type_.as_deref(), ctx.network).await,
        C::WalletImport(args) => {
            let key = args.private_key.or(args.private_key_flag);
            wallet::wallet_import(
                args.type_.as_deref(),
                args.address.as_deref(),
                key.as_deref(),
                ctx.network,
            )
            .await
        }
        C::WalletList => wallet::wallet_list(ctx.network, ctx).await,
        C::WalletShow(args) => wallet::wallet_show(args.address.as_deref(), ctx.network, ctx).await,
        C::WalletRemove(args) => {
            wallet::wallet_remove(args.address.as_deref(), ctx.network, args.force, ctx).await
        }
        C::WalletLogout(args) => {
            wallet::wallet_logout(args.address.as_deref(), ctx.network, ctx).await
        }
        C::WalletRegister(args) => {
            wallet::wallet_register(
                args.broker_id.as_deref(),
                args.address.as_deref(),
                ctx.network,
            )
            .await
        }
        C::WalletAddKey(args) => {
            wallet::wallet_add_key(
                args.address.as_deref(),
                args.scope.as_deref(),
                ctx.network,
                args.broker_id.as_deref(),
            )
            .await
        }
        C::WalletRevokeKey(args) => {
            auth::revoke_key(args.acct.account.as_deref(), ctx.network, args.force).await
        }

        C::AuthImport(args) => {
            auth::import_key(
                args.private_key.as_deref(),
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::AuthList(args) => auth::list(ctx.network, ctx, args.ids).await,
        C::AuthShow(args) => auth::show(args.acct.account.as_deref(), ctx.network, ctx).await,
        C::AuthLogout(args) => auth::logout(args.account_id.as_deref(), ctx.network, false).await,
        C::AuthCleanup => auth::cleanup(ctx.network).await,
        C::AuthExportKey(args) => auth::export_key(args.account_id.as_deref(), ctx.network).await,

        C::AccountInfo(args) => account::info(args.acct.account.as_deref(), ctx).await,
        C::AccountBalance(args) => account::balance(args.acct.account.as_deref(), ctx).await,
        C::AccountStatistics(args) => account::statistics(args.acct.account.as_deref(), ctx).await,
        C::AccountLimits(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            account::limits(args.acct.account.as_deref(), symbol.as_deref(), ctx).await
        }
        C::KeyInfo(args) => account::key_info(args.acct.account.as_deref(), ctx).await,
        C::FeeTier(args) => account::fee_tier(args.acct.account.as_deref(), ctx).await,
        C::AccountLiquidations(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            account::liquidations(
                symbol.as_deref(),
                args.page,
                args.size,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }

        C::OrderPlace(args) => {
            let symbol = normalize_symbol(&args.symbol).map_err(AppError::from)?;
            let (side, type_, quantity) =
                resolve_order_place(&args.side, args.type_.as_deref(), args.quantity.as_deref())?;
            order::place(
                &symbol,
                &side,
                &type_,
                &quantity,
                args.price.as_deref(),
                args.client_order_id.as_deref(),
                args.reduce_only,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::OrderCancel(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            order::cancel(
                &args.order_id,
                symbol.as_deref(),
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::OrderEdit(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            order::edit(
                &args.order_id,
                symbol.as_deref(),
                args.price.as_deref(),
                args.quantity.as_deref(),
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::OrderCancelAll(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            order::cancel_all(symbol.as_deref(), args.acct.account.as_deref(), ctx).await
        }
        C::OrderList(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            let status = args.status.or_else(|| {
                if args.all {
                    None
                } else {
                    Some("INCOMPLETE".to_string())
                }
            });
            order::list_orders(
                symbol.as_deref(),
                status.as_deref(),
                args.side.as_deref(),
                args.order_type.as_deref(),
                args.sort_by.as_deref(),
                args.page,
                args.size,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::BatchOrderPlace(args) => {
            order::batch_place(&args.orders, args.acct.account.as_deref(), ctx).await
        }
        C::BatchOrderCancel(args) => {
            order::batch_cancel(&args.order_ids, args.acct.account.as_deref(), ctx).await
        }
        C::BatchOrderCancelByClientId(args) => {
            order::batch_cancel_by_client_id(
                &args.client_order_ids,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::OrderGet(args) => {
            order::get_order(
                args.order_id.as_deref(),
                args.client_order_id.as_deref(),
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::OrderCancelByClientId(args) => {
            let symbol = normalize_symbol(&args.symbol).map_err(AppError::from)?;
            order::cancel_by_client_id(
                &args.client_order_id,
                &symbol,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::OrderTrades(args) => {
            order::order_trades(&args.order_id, args.acct.account.as_deref(), ctx).await
        }

        C::AlgoOrderPlace(args) => {
            let symbol = normalize_symbol(&args.symbol).map_err(AppError::from)?;
            algo::place_algo_order(
                &symbol,
                &args.side,
                &args.algo_type,
                &args.quantity,
                args.trigger_price.as_deref(),
                args.callback_rate.as_deref(),
                args.price.as_deref(),
                args.tp_trigger_price.as_deref(),
                args.tp_price.as_deref(),
                args.sl_trigger_price.as_deref(),
                args.sl_price.as_deref(),
                args.reduce_only,
                args.client_order_id.as_deref(),
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::AlgoOrderCancel(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            algo::cancel_algo_order(
                &args.order_id,
                symbol.as_deref(),
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::AlgoOrderEdit(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            algo::edit_algo_order(
                &args.order_id,
                symbol.as_deref(),
                args.price.as_deref(),
                args.quantity.as_deref(),
                args.trigger_price.as_deref(),
                args.callback_rate.as_deref(),
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::AlgoOrderCancelAll(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            algo::cancel_all_algo_orders(
                symbol.as_deref(),
                args.algo_type.as_deref(),
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::AlgoOrderList(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            let status = args.status.or_else(|| {
                if args.all {
                    None
                } else {
                    Some("INCOMPLETE".to_string())
                }
            });
            algo::list_algo_orders(
                symbol.as_deref(),
                status.as_deref(),
                args.page,
                args.size,
                args.algo_type.as_deref(),
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::AlgoOrderTrades(args) => {
            algo::algo_order_trades(&args.order_id, args.acct.account.as_deref(), ctx).await
        }
        C::AlgoOrderGet(args) => {
            algo::get_algo_order(&args.order_id, args.acct.account.as_deref(), ctx).await
        }
        C::AlgoOrderCancelByClientId(args) => {
            let symbol = normalize_symbol(&args.symbol).map_err(AppError::from)?;
            algo::cancel_algo_order_by_client_id(
                &args.client_order_id,
                &symbol,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }

        C::PositionsList(args) => {
            positions::list_positions(args.acct.account.as_deref(), ctx).await
        }
        C::PositionsClose(args) => {
            let symbol = normalize_symbol(&args.symbol).map_err(AppError::from)?;
            positions::close_position(&symbol, args.acct.account.as_deref(), ctx, args.quantity)
                .await
        }
        C::PositionsHistory(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            positions::position_history(
                symbol.as_deref(),
                args.start_time,
                args.end_time,
                args.page,
                args.size,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }

        C::Leverage(args) => {
            let symbol = normalize_symbol(&args.symbol).map_err(AppError::from)?;
            leverage::get_or_set_leverage(&symbol, args.value, args.acct.account.as_deref(), ctx)
                .await
        }
        C::Trades(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            trades::list_trades(
                symbol.as_deref(),
                args.start_time,
                args.end_time,
                args.page,
                args.size,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::FundingHistory(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            funding::funding_history(
                symbol.as_deref(),
                args.start_time,
                args.end_time,
                args.page,
                args.size,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }

        C::MarketPrice(args) => {
            let symbol = normalize_symbol(&args.symbol).map_err(AppError::from)?;
            market::get_price(&args.symbol, &symbol, ctx).await
        }
        C::MarketOrderbook(args) => {
            let symbol = normalize_symbol(&args.symbol).map_err(AppError::from)?;
            market::get_orderbook(&symbol, ctx, args.depth).await
        }
        C::MarketTrades(args) => {
            if let Some(size) = args.size {
                if size <= 0 {
                    return Err(fail(format!(
                        "Invalid --size value: \"{size}\". Must be a positive integer."
                    )));
                }
            }
            let symbol = normalize_symbol(&args.symbol).map_err(AppError::from)?;
            market::get_market_trades(&symbol, args.size, ctx).await
        }
        C::Symbols(args) => market::get_symbols(args.info, ctx).await,
        C::Kline(args) => {
            if let Some(size) = args.size {
                if size <= 0 {
                    return Err(fail(format!(
                        "Invalid --size value: \"{size}\". Must be a positive integer."
                    )));
                }
            }
            let symbol = normalize_symbol(&args.symbol).map_err(AppError::from)?;
            market::get_kline(&symbol, &args.type_, args.size, ctx).await
        }
        C::FundingRates(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            market::get_funding_rates(symbol.as_deref(), ctx).await
        }
        C::PriceChanges(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            market::get_price_changes(symbol.as_deref(), ctx).await
        }
        C::OpenInterest(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            market::get_open_interest(symbol.as_deref(), ctx).await
        }
        C::LiquidatedPositions(args) => {
            let symbol = crate::output::normalize_optional_symbol(args.symbol.as_deref())
                .map_err(AppError::from)?;
            market::get_liquidated_positions(symbol.as_deref(), args.page, args.size, ctx).await
        }
        C::SystemStatus => market::get_system_status(ctx).await,

        C::FaucetUsdc(args) => {
            faucet::faucet_usdc(
                &args.address,
                args.chain_id.as_deref(),
                ctx,
                args.broker_id.as_deref(),
            )
            .await
        }

        C::BrokerCreate(args) => broker::broker_create(&args, ctx).await,
        C::BrokerStatus(args) => {
            broker::broker_status(args.address.as_deref(), ctx.network, ctx).await
        }

        C::Chains(args) => {
            assets::get_chains(ctx.network, ctx, args.broker_id.as_deref(), args.verbose).await
        }
        C::Tokens(args) => assets::get_tokens(ctx.network, ctx, args.verbose).await,
        C::DepositInfo(args) => assets::deposit_info(&args.token, args.chain_id, ctx).await,
        C::Withdraw(args) => {
            let Some(amount) = args.amount.as_deref().filter(|a| !a.is_empty()) else {
                return Err(fail("Missing required option: --amount"));
            };
            assets::withdraw(
                &args.token,
                amount,
                args.receiver.as_deref(),
                args.chain_id,
                args.acct.account.as_deref(),
                ctx,
                args.raw,
                args.allow_cross_chain,
            )
            .await
        }
        C::AssetHistory(args) => {
            assets::asset_history(
                args.token.as_deref(),
                args.side.as_deref(),
                args.status.as_deref(),
                args.page,
                args.size,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }

        C::SettlePnl(args) => settle::settle_pnl(args.acct.account.as_deref(), ctx).await,
        C::SettlePnlHistory(args) => {
            settle::settle_pnl_history(args.page, args.size, args.acct.account.as_deref(), ctx)
                .await
        }
        C::ReferralInfo(args) => referral::info(args.acct.account.as_deref(), ctx).await,
        C::DistributionHistory(args) => {
            stats::distribution_history(
                args.status.as_deref(),
                args.type_.as_deref(),
                args.start_time,
                args.end_time,
                args.page,
                args.size,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::VolumeStats(args) => stats::volume_stats(args.acct.account.as_deref(), ctx).await,
        C::NotificationInbox(args) => {
            notification::inbox(
                args.type_.as_deref(),
                args.page,
                args.size,
                args.acct.account.as_deref(),
                ctx,
            )
            .await
        }
        C::NotificationUnread(args) => {
            notification::inbox_unread(args.acct.account.as_deref(), ctx).await
        }
    }
}

/// `order-place` accepts both the 4-argument form and the short BID/ASK form.
fn resolve_order_place(
    side: &str,
    type_: Option<&str>,
    quantity: Option<&str>,
) -> Result<(String, String, String), AppError> {
    let Some(type_) = type_ else {
        // Fewer than three positionals: the TS CLI reports cac's missing-args error.
        return Err(fail_hints(
            "missing required args for command `order-place <symbol> <side> [type] <quantity>`",
            vec![
                "Usage examples:".to_string(),
                "  orderly order-place <symbol> <side> [type] <quantity> --help".to_string(),
            ],
        ));
    };

    if let Some(quantity) = quantity {
        return Ok((side.to_string(), type_.to_string(), quantity.to_string()));
    }

    let resolved_quantity = type_.to_string();
    let resolved_type = side.to_uppercase();
    let resolved_side = match resolved_type.as_str() {
        "BID" => "BUY".to_string(),
        "ASK" => "SELL".to_string(),
        _ => {
            return Err(fail_hints(
                "Invalid short form. Use BID (market buy) or ASK (market sell), or provide all 4 args: <symbol> <side> <type> <quantity>",
                vec![
                    "Examples:".to_string(),
                    "  orderly order-place PERP_ETH_USDC BID 0.01".to_string(),
                    "  orderly order-place PERP_ETH_USDC BUY MARKET 0.01".to_string(),
                ],
            ))
        }
    };
    Ok((resolved_side, resolved_type, resolved_quantity))
}
