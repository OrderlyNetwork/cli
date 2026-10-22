//! `src/commands/account.ts`

use crate::account_select::create_authenticated_client;
use crate::api::obj;
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::output;
use serde_json::{Map, Value};

/// Mirrors the local `unwrap()` helper in account.ts.
pub fn unwrap(data: &Value) -> Value {
    match data.as_object() {
        Some(o) if o.contains_key("data") && is_truthy(o.get("success")) => {
            o.get("data").cloned().unwrap_or(Value::Null)
        }
        _ => data.clone(),
    }
}

fn is_truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Null) | None => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn extract_flat_fields(info: &Value) -> Value {
    let mut out = Map::new();
    if let Some(o) = info.as_object() {
        for (key, value) in o {
            if !value.is_object() && !value.is_null() {
                out.insert(key.clone(), value.clone());
            }
        }
    }
    Value::Object(out)
}

fn limits_to_rows(info: &Value) -> Value {
    let imr_factor = info.get("imr_factor").and_then(|v| v.as_object());
    let max_notional = info.get("max_notional").and_then(|v| v.as_object());

    let mut symbols: Vec<String> = Vec::new();
    for map in [imr_factor, max_notional].into_iter().flatten() {
        for key in map.keys() {
            if !symbols.contains(key) {
                symbols.push(key.clone());
            }
        }
    }

    let max_leverage = info
        .get("max_leverage")
        .cloned()
        .unwrap_or_else(|| Value::String(String::new()));

    let rows = symbols.iter().map(|sym| {
        let lookup = |map: Option<&Map<String, Value>>| {
            map.and_then(|m| m.get(sym))
                .cloned()
                .unwrap_or_else(|| Value::String(String::new()))
        };
        obj(vec![
            ("symbol", Value::String(sym.clone())),
            ("max_leverage", max_leverage.clone()),
            ("imr_factor", lookup(imr_factor)),
            ("max_notional", lookup(max_notional)),
        ])
    });

    Value::Array(rows.collect())
}

fn extract_fee_tier(info: &Value) -> Value {
    let get = |key: &str| info.get(key).cloned().unwrap_or(Value::Null);
    obj(vec![
        ("account_id", get("account_id")),
        (
            "futures",
            obj(vec![
                ("maker_fee_rate", get("futures_maker_fee_rate")),
                ("taker_fee_rate", get("futures_taker_fee_rate")),
            ]),
        ),
        (
            "rwa",
            obj(vec![
                ("maker_fee_rate", get("rwa_maker_fee_rate")),
                ("taker_fee_rate", get("rwa_taker_fee_rate")),
            ]),
        ),
        (
            "default",
            obj(vec![
                ("maker_fee_rate", get("maker_fee_rate")),
                ("taker_fee_rate", get("taker_fee_rate")),
            ]),
        ),
    ])
}

pub async fn info(account: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let raw = client.get_account_info().await?;
    if ctx.is_csv() {
        output(&extract_flat_fields(&unwrap(&raw)), ctx.format);
    } else {
        output(&raw, ctx.format);
    }
    Ok(())
}

pub async fn limits(account: Option<&str>, symbol: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let raw = client.get_account_info().await?;
    let info = unwrap(&raw);

    if let Some(symbol) = symbol {
        let symbol_data = match client
            .get_public(&format!("/v1/public/info/{symbol}"))
            .await
        {
            Ok(resp) if resp.get("success").and_then(|s| s.as_bool()) == Some(true) => {
                resp.get("data").cloned()
            }
            _ => None,
        };

        let Some(symbol_data) = symbol_data else {
            return Err(super::fail_hints(
                format!("Symbol {symbol} not found."),
                vec![super::SYMBOL_HINT.to_string()],
            ));
        };

        if ctx.is_csv() {
            let imr_factor = info.get("imr_factor").and_then(|v| v.as_object());
            let max_notional = info.get("max_notional").and_then(|v| v.as_object());
            let account_max_leverage = info
                .get("max_leverage")
                .cloned()
                .unwrap_or_else(|| Value::String(String::new()));
            let account_imr_factor = imr_factor
                .and_then(|m| m.get(symbol))
                .cloned()
                .unwrap_or_else(|| Value::String(String::new()));
            let account_max_notional = max_notional
                .and_then(|m| m.get(symbol))
                .cloned()
                .unwrap_or_else(|| Value::String(String::new()));

            let mut row = obj(vec![
                ("symbol", Value::String(symbol.to_string())),
                ("account_max_leverage", account_max_leverage),
                ("account_imr_factor", account_imr_factor),
                ("account_max_notional", account_max_notional),
            ]);
            if let (Value::Object(m), Value::Object(extra)) = (&mut row, &symbol_data) {
                for (k, v) in extra {
                    m.insert(k.clone(), v.clone());
                }
            }
            output(&obj(vec![("rows", Value::Array(vec![row]))]), ctx.format);
        } else {
            let mut symbol_obj = obj(vec![("symbol", Value::String(symbol.to_string()))]);
            if let (Value::Object(m), Value::Object(extra)) = (&mut symbol_obj, &symbol_data) {
                for (k, v) in extra {
                    m.insert(k.clone(), v.clone());
                }
            }
            output(
                &obj(vec![("account", info.clone()), ("symbol", symbol_obj)]),
                ctx.format,
            );
        }
    } else if ctx.is_csv() {
        output(&obj(vec![("rows", limits_to_rows(&info))]), ctx.format);
    } else {
        output(
            &obj(vec![
                (
                    "max_leverage",
                    info.get("max_leverage").cloned().unwrap_or(Value::Null),
                ),
                (
                    "imr_factor",
                    info.get("imr_factor").cloned().unwrap_or(Value::Null),
                ),
                (
                    "max_notional",
                    info.get("max_notional").cloned().unwrap_or(Value::Null),
                ),
            ]),
            ctx.format,
        );
    }
    Ok(())
}

pub async fn balance(account: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let data = client.get_balances().await?;
    output(&data, ctx.format);
    Ok(())
}

pub async fn statistics(account: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let data = client.get_statistics().await?;
    output(&data, ctx.format);
    Ok(())
}

pub async fn key_info(account: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let data = client.get_key_info().await?;
    output(&data, ctx.format);
    Ok(())
}

pub async fn fee_tier(account: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let raw = client.get_account_info().await?;
    output(&extract_fee_tier(&unwrap(&raw)), ctx.format);
    Ok(())
}

pub async fn liquidations(
    symbol: Option<&str>,
    page: Option<i64>,
    size: Option<i64>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client.get_liquidations(symbol, page, size).await?;
    output(&result, ctx.format);
    Ok(())
}
