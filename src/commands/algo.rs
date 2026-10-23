//! `src/commands/algo.ts`

use crate::account_select::create_authenticated_client;
use crate::api::{obj, OrderlyClient};
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::output;
use serde_json::Value;

const VALID_ALGO_TYPES: [&str; 5] = [
    "STOP",
    "TP_SL",
    "POSITIONAL_TP_SL",
    "TRAILING_STOP",
    "BRACKET",
];
const VALID_SIDES: [&str; 2] = ["BUY", "SELL"];

/// Normalize a callback rate the way the TS CLI does (percent → decimal).
/// Returns `(normalized_decimal_string, original_rate)`.
fn normalize_callback_rate(raw: &str) -> (String, f64) {
    let rate = super::js_number(raw);
    let mut value = raw.to_string();
    if rate >= 1.0 {
        value = crate::output::js_f64_to_string(rate / 100.0);
    }
    (value, rate)
}

fn callback_rate_error(rate: f64, normalized: f64) -> AppError {
    let got = if rate >= 1.0 {
        format!("{}%", crate::output::js_f64_to_string(rate))
    } else {
        format!(
            "{} ({:.2}%)",
            crate::output::js_f64_to_string(rate),
            normalized * 100.0
        )
    };
    super::fail_hints(
        format!("Callback rate must be between 1% and 15%. Got {got}."),
        vec![
            "Use percentage format: --callback-rate 5 (for 5%)".to_string(),
            "Or decimal format: --callback-rate 0.05 (for 5%)".to_string(),
        ],
    )
}

fn child_order(
    symbol: &str,
    algo_type: &str,
    side: &str,
    type_: &str,
    trigger_price: &str,
    price: Option<&str>,
) -> Value {
    let mut pairs: Vec<(&str, Value)> = vec![
        ("symbol", Value::String(symbol.to_string())),
        ("algo_type", Value::String(algo_type.to_string())),
        ("side", Value::String(side.to_string())),
        ("type", Value::String(type_.to_string())),
        ("trigger_price", Value::String(trigger_price.to_string())),
    ];
    if let Some(p) = price {
        pairs.push(("price", Value::String(p.to_string())));
    }
    pairs.push(("reduce_only", Value::Bool(true)));
    obj(pairs)
}

/// True when an API error body mentions "already complete".
pub fn is_already_complete_error(err: &AppError) -> bool {
    let AppError::Api { body, .. } = err else {
        return false;
    };
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_default();
    message.to_lowercase().contains("already complete")
}

async fn check_is_bracket_root(client: &OrderlyClient, order_id: &str) -> bool {
    match client.find_algo_order_by_id(order_id).await {
        Ok(res) => {
            res.get("success").and_then(|s| s.as_bool()) == Some(true)
                && res
                    .get("data")
                    .and_then(|d| d.get("algo_type"))
                    .and_then(|t| t.as_str())
                    == Some("BRACKET")
        }
        Err(_) => false,
    }
}

/// Reject TP/SL triggers on the wrong side of the current mark price.
#[allow(clippy::too_many_arguments)]
async fn check_trigger_prices(
    client: &OrderlyClient,
    symbol: &str,
    valid_side: &str,
    valid_algo_type: &str,
    tp_trigger_price: Option<&str>,
    sl_trigger_price: Option<&str>,
) -> Result<(), AppError> {
    if !matches!(valid_algo_type, "TP_SL" | "POSITIONAL_TP_SL" | "BRACKET")
        || (tp_trigger_price.is_none() && sl_trigger_price.is_none())
    {
        return Ok(());
    }

    let upper = symbol.to_uppercase();
    let Ok(raw) = client.get_market_price(&upper).await else {
        return Ok(());
    };
    let market_data = raw.get("data").unwrap_or(&raw);
    let Some(mark) = market_data.get("mark_price") else {
        return Ok(());
    };
    let Some(mark_price) = mark
        .as_f64()
        .or_else(|| mark.as_str().and_then(|s| s.parse::<f64>().ok()))
    else {
        return Ok(());
    };

    let mark_label = crate::commands::order::js_string_of(mark);
    let tp = tp_trigger_price.map(super::js_number);
    let sl = sl_trigger_price.map(super::js_number);

    let is_closing = valid_algo_type == "TP_SL" || valid_algo_type == "POSITIONAL_TP_SL";
    let is_long = if is_closing {
        valid_side == "SELL"
    } else {
        valid_side == "BUY"
    };

    if is_long {
        if let Some(tp) = tp {
            if tp <= mark_price {
                return Err(super::fail(format!(
                    "Take-profit trigger price ({}) must be above current mark price ({mark_label}) for a long position.",
                    crate::output::js_f64_to_string(tp)
                )));
            }
        }
        if let Some(sl) = sl {
            if sl >= mark_price {
                return Err(super::fail(format!(
                    "Stop-loss trigger price ({}) must be below current mark price ({mark_label}) for a long position.",
                    crate::output::js_f64_to_string(sl)
                )));
            }
        }
    } else {
        if let Some(tp) = tp {
            if tp >= mark_price {
                return Err(super::fail(format!(
                    "Take-profit trigger price ({}) must be below current mark price ({mark_label}) for a short position.",
                    crate::output::js_f64_to_string(tp)
                )));
            }
        }
        if let Some(sl) = sl {
            if sl <= mark_price {
                return Err(super::fail(format!(
                    "Stop-loss trigger price ({}) must be above current mark price ({mark_label}) for a short position.",
                    crate::output::js_f64_to_string(sl)
                )));
            }
        }
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn place_algo_order(
    symbol: &str,
    side: &str,
    algo_type: &str,
    quantity: &str,
    trigger_price: Option<&str>,
    callback_rate: Option<&str>,
    price: Option<&str>,
    tp_trigger_price: Option<&str>,
    tp_price: Option<&str>,
    sl_trigger_price: Option<&str>,
    sl_price: Option<&str>,
    reduce_only: bool,
    dry_run: bool,
    client_order_id: Option<&str>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let valid_side = side.to_uppercase();
    if !VALID_SIDES.contains(&valid_side.as_str()) {
        return Err(super::fail(format!(
            "Invalid side. Use {}.",
            VALID_SIDES.join(" or ")
        )));
    }

    let valid_algo_type = algo_type.to_uppercase();
    if !VALID_ALGO_TYPES.contains(&valid_algo_type.as_str()) {
        return Err(super::fail(format!(
            "Invalid algo type. Use one of: {}",
            VALID_ALGO_TYPES.join(", ")
        )));
    }

    let trigger_price = trigger_price.filter(|v| !v.is_empty());
    let price = price.filter(|v| !v.is_empty());
    let tp_trigger_price = tp_trigger_price.filter(|v| !v.is_empty());
    let tp_price = tp_price.filter(|v| !v.is_empty());
    let sl_trigger_price = sl_trigger_price.filter(|v| !v.is_empty());
    let sl_price = sl_price.filter(|v| !v.is_empty());
    let client_order_id = client_order_id.filter(|v| !v.is_empty());

    let mut normalized_callback_rate = callback_rate.map(String::from);
    if valid_algo_type == "TRAILING_STOP" {
        let Some(rate_raw) = callback_rate.filter(|v| !v.is_empty()) else {
            return Err(super::fail(
                "--callback-rate is required for TRAILING_STOP orders.",
            ));
        };
        let (normalized, original) = normalize_callback_rate(rate_raw);
        let normalized_value = super::js_number(&normalized);
        if normalized_value < 0.01 || normalized_value > 0.15 {
            return Err(callback_rate_error(original, normalized_value));
        }
        normalized_callback_rate = Some(normalized);
    } else if valid_algo_type == "TP_SL" || valid_algo_type == "POSITIONAL_TP_SL" {
        if tp_trigger_price.is_none() && sl_trigger_price.is_none() {
            return Err(super::fail(
                "At least one of --tp-trigger-price or --sl-trigger-price is required for TP_SL/POSITIONAL_TP_SL orders.",
            ));
        }
    } else if valid_algo_type == "STOP" {
        if trigger_price.is_none() {
            return Err(super::fail("--trigger-price is required for STOP orders."));
        }
    } else if valid_algo_type == "BRACKET" {
        if trigger_price.is_none() {
            return Err(super::fail(
                "--trigger-price is required for BRACKET orders.",
            ));
        }
        if tp_trigger_price.is_none() && sl_trigger_price.is_none() {
            return Err(super::fail(
                "At least one of --tp-trigger-price or --sl-trigger-price is required for BRACKET orders.",
            ));
        }
    }

    let client = if dry_run {
        None
    } else {
        let (_, _, c) = create_authenticated_client(account, ctx.network).await?;
        check_trigger_prices(
            &c,
            symbol,
            &valid_side,
            &valid_algo_type,
            tp_trigger_price,
            sl_trigger_price,
        )
        .await?;
        Some(c)
    };

    let body = if valid_algo_type == "TP_SL" || valid_algo_type == "POSITIONAL_TP_SL" {
        let is_positional = valid_algo_type == "POSITIONAL_TP_SL";
        let mut child_orders: Vec<Value> = Vec::new();

        if let Some(tp_trigger) = tp_trigger_price {
            let type_ = if is_positional {
                "CLOSE_POSITION"
            } else if tp_price.is_some() {
                "LIMIT"
            } else {
                "MARKET"
            };
            child_orders.push(child_order(
                symbol,
                "TAKE_PROFIT",
                &valid_side,
                type_,
                tp_trigger,
                tp_price,
            ));
        }
        if let Some(sl_trigger) = sl_trigger_price {
            let type_ = if is_positional {
                "CLOSE_POSITION"
            } else if sl_price.is_some() {
                "LIMIT"
            } else {
                "MARKET"
            };
            child_orders.push(child_order(
                symbol,
                "STOP_LOSS",
                &valid_side,
                type_,
                sl_trigger,
                sl_price,
            ));
        }

        let mut pairs: Vec<(&str, Value)> = vec![
            ("symbol", Value::String(symbol.to_string())),
            ("algo_type", Value::String(valid_algo_type.clone())),
        ];
        if !is_positional {
            pairs.push(("quantity", Value::String(quantity.to_string())));
        }
        if let Some(id) = client_order_id {
            pairs.push(("client_order_id", Value::String(id.to_string())));
        }
        pairs.push(("child_orders", Value::Array(child_orders)));
        obj(pairs)
    } else if valid_algo_type == "BRACKET" {
        let opposite_side = if valid_side == "BUY" { "SELL" } else { "BUY" };
        let mut tpsl_children: Vec<Value> = Vec::new();

        if let Some(tp_trigger) = tp_trigger_price {
            let type_ = if tp_price.is_some() {
                "LIMIT"
            } else {
                "MARKET"
            };
            tpsl_children.push(child_order(
                symbol,
                "TAKE_PROFIT",
                opposite_side,
                type_,
                tp_trigger,
                tp_price,
            ));
        }
        if let Some(sl_trigger) = sl_trigger_price {
            let type_ = if sl_price.is_some() {
                "LIMIT"
            } else {
                "MARKET"
            };
            tpsl_children.push(child_order(
                symbol,
                "STOP_LOSS",
                opposite_side,
                type_,
                sl_trigger,
                sl_price,
            ));
        }

        let nested = obj(vec![
            ("symbol", Value::String(symbol.to_string())),
            ("algo_type", Value::String("TP_SL".to_string())),
            ("quantity", Value::String(quantity.to_string())),
            ("child_orders", Value::Array(tpsl_children)),
        ]);

        let mut pairs: Vec<(&str, Value)> = vec![
            ("symbol", Value::String(symbol.to_string())),
            ("algo_type", Value::String(valid_algo_type.clone())),
            (
                "type",
                Value::String(if price.is_some() { "LIMIT" } else { "MARKET" }.to_string()),
            ),
            ("side", Value::String(valid_side.clone())),
            ("quantity", Value::String(quantity.to_string())),
            (
                "trigger_price",
                Value::String(trigger_price.unwrap_or_default().to_string()),
            ),
        ];
        if let Some(p) = price {
            pairs.push(("price", Value::String(p.to_string())));
        }
        if let Some(id) = client_order_id {
            pairs.push(("client_order_id", Value::String(id.to_string())));
        }
        pairs.push(("child_orders", Value::Array(vec![nested])));
        obj(pairs)
    } else {
        let mut pairs: Vec<(&str, Value)> = vec![
            ("symbol", Value::String(symbol.to_string())),
            ("algo_type", Value::String(valid_algo_type.clone())),
            (
                "type",
                Value::String(if price.is_some() { "LIMIT" } else { "MARKET" }.to_string()),
            ),
            ("side", Value::String(valid_side.clone())),
            ("quantity", Value::String(quantity.to_string())),
        ];
        if let Some(tp) = trigger_price {
            pairs.push(("trigger_price", Value::String(tp.to_string())));
        }
        if let Some(p) = price {
            pairs.push(("price", Value::String(p.to_string())));
        }
        if let Some(rate) = &normalized_callback_rate {
            pairs.push(("callback_rate", Value::String(rate.clone())));
        }
        if reduce_only {
            pairs.push(("reduce_only", Value::Bool(true)));
        }
        if let Some(id) = client_order_id {
            pairs.push(("client_order_id", Value::String(id.to_string())));
        }
        obj(pairs)
    };

    if dry_run {
        return super::dry_run::emit(
            &OrderlyClient::place_algo_order_spec(&body),
            Some("Trigger prices are validated against the live mark price only on a real run."),
            &[],
        );
    }

    let client = client.expect("client is created when not in dry-run mode");
    let result = client.place_algo_order(&body).await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn cancel_algo_order(
    order_id: &str,
    symbol: Option<&str>,
    dry_run: bool,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    if dry_run {
        let spec = OrderlyClient::cancel_algo_order_spec(order_id, symbol.unwrap_or(""));
        let (note, requires) = match symbol {
            Some(_) => (None, &[][..]),
            None => (
                Some(
                    "--symbol omitted: the live command resolves the symbol with GET /v1/algo/order/{order_id} before cancelling.",
                ),
                &["GET /v1/algo/order/{order_id} (authenticated)"][..],
            ),
        };
        return super::dry_run::emit(&spec, note, requires);
    }

    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;

    let mut order_symbol = symbol.filter(|s| !s.is_empty()).map(String::from);
    if order_symbol.is_none() {
        let order_res = client.find_algo_order_by_id(order_id).await?;
        let success = order_res.get("success").and_then(|s| s.as_bool()) == Some(true);
        let data = order_res.get("data").filter(|d| !d.is_null()).cloned();
        let Some(data) = data.filter(|_| success) else {
            return Err(super::fail(format!("Algo order {order_id} not found.")));
        };
        order_symbol = data
            .get("symbol")
            .and_then(|s| s.as_str())
            .map(String::from);
    }

    match client
        .cancel_algo_order(order_id, order_symbol.as_deref().unwrap_or(""))
        .await
    {
        Ok(result) => {
            output(&result, ctx.format);
            Ok(())
        }
        Err(err) => {
            if is_already_complete_error(&err) && check_is_bracket_root(&client, order_id).await {
                return Err(super::fail_hints(
                    format!(
                        "BRACKET root order {order_id} has already triggered and cannot be cancelled."
                    ),
                    vec![
                        "BRACKET orders spawn TP/SL child orders once triggered.".to_string(),
                        "Use `orderly algo-order-list` to find and cancel active child orders."
                            .to_string(),
                        "Or use `orderly algo-order-cancel-all` to cancel all open algo orders."
                            .to_string(),
                    ],
                ));
            }
            Err(err)
        }
    }
}

pub async fn cancel_all_algo_orders(
    symbol: Option<&str>,
    algo_type: Option<&str>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client.cancel_all_algo_orders(symbol, algo_type).await?;
    output(&result, ctx.format);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn edit_algo_order(
    order_id: &str,
    symbol: Option<&str>,
    price: Option<&str>,
    quantity: Option<&str>,
    trigger_price: Option<&str>,
    callback_rate: Option<&str>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let price = price.filter(|v| !v.is_empty());
    let quantity = quantity.filter(|v| !v.is_empty());
    let trigger_price = trigger_price.filter(|v| !v.is_empty());
    let callback_rate = callback_rate.filter(|v| !v.is_empty());

    if price.is_none() && quantity.is_none() && trigger_price.is_none() && callback_rate.is_none() {
        return Err(super::fail_hints(
            "At least one of --price, --quantity, --trigger-price, or --callback-rate is required.",
            vec![
                "Examples:".to_string(),
                "  orderly algo-order-edit 123456 --price 2500".to_string(),
                "  orderly algo-order-edit 123456 --quantity 0.02".to_string(),
                "  orderly algo-order-edit 123456 --trigger-price 1500".to_string(),
                "  orderly algo-order-edit 123456 --callback-rate 0.03".to_string(),
            ],
        ));
    }

    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;

    let mut order_symbol = symbol.filter(|s| !s.is_empty()).map(String::from);
    if order_symbol.is_none() {
        let order_res = client.find_algo_order_by_id(order_id).await?;
        let success = order_res.get("success").and_then(|s| s.as_bool()) == Some(true);
        let data = order_res.get("data").filter(|d| !d.is_null()).cloned();
        let Some(data) = data.filter(|_| success) else {
            return Err(super::fail(format!("Algo order {order_id} not found.")));
        };
        order_symbol = data
            .get("symbol")
            .and_then(|s| s.as_str())
            .map(String::from);
    }

    let build = || -> Result<Value, AppError> {
        let mut pairs: Vec<(&str, Value)> = Vec::new();
        if let Some(p) = price {
            pairs.push(("price", crate::api::js_number(super::js_number(p))));
        }
        if let Some(q) = quantity {
            pairs.push(("quantity", crate::api::js_number(super::js_number(q))));
        }
        if let Some(t) = trigger_price {
            pairs.push(("trigger_price", crate::api::js_number(super::js_number(t))));
        }
        if let Some(rate_raw) = callback_rate {
            let (normalized, original) = normalize_callback_rate(rate_raw);
            let normalized_value = super::js_number(&normalized);
            if normalized_value < 0.01 || normalized_value > 0.15 {
                return Err(callback_rate_error(original, normalized_value));
            }
            pairs.push(("callback_rate", crate::api::js_number(normalized_value)));
        }
        Ok(obj(pairs))
    };

    let updates = build()?;

    match client
        .edit_algo_order(order_id, &updates, order_symbol.as_deref().unwrap_or(""))
        .await
    {
        Ok(result) => {
            output(&result, ctx.format);
            Ok(())
        }
        Err(err) => {
            if is_already_complete_error(&err) && check_is_bracket_root(&client, order_id).await {
                return Err(super::fail_hints(
                    format!(
                        "BRACKET root order {order_id} has already triggered and cannot be edited."
                    ),
                    vec![
                        "BRACKET orders spawn TP/SL child orders once triggered.".to_string(),
                        "Use `orderly algo-order-list` to find and edit active child orders."
                            .to_string(),
                    ],
                ));
            }
            Err(err)
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn list_algo_orders(
    symbol: Option<&str>,
    status: Option<&str>,
    page: Option<i64>,
    size: Option<i64>,
    algo_type: Option<&str>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client
        .get_algo_orders(symbol, status, page, size, algo_type)
        .await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn get_algo_order(
    order_id: &str,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client.find_algo_order_by_id(order_id).await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn cancel_algo_order_by_client_id(
    client_order_id: &str,
    symbol: &str,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client
        .cancel_algo_order_by_client_id(client_order_id, symbol)
        .await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn algo_order_trades(
    order_id: &str,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client.get_algo_order_trades(order_id).await?;
    output(&result, ctx.format);
    Ok(())
}
