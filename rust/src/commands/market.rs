//! `src/commands/market.ts`

use crate::api::{obj, OrderlyClient};
use crate::cli::Ctx;
use crate::config::get_api_base_url;
use crate::error::AppError;
use crate::output::output;
use crate::types::Network;
use crate::ws::fetch_ws_snapshot;
use serde_json::Value;

const VALID_KLINE_TYPES: [&str; 10] = [
    "1m", "5m", "15m", "30m", "1h", "4h", "12h", "1d", "1w", "1mon",
];

fn kline_to_tv(type_: &str) -> Option<&'static str> {
    Some(match type_ {
        "1m" => "1",
        "5m" => "5",
        "15m" => "15",
        "30m" => "30",
        "1h" => "60",
        "4h" => "240",
        "12h" => "720",
        "1d" => "1D",
        "1w" => "1W",
        "1mon" => "1M",
        _ => return None,
    })
}

fn tv_resolution_seconds(resolution: &str) -> i64 {
    match resolution {
        "1" => 60,
        "3" => 180,
        "5" => 300,
        "15" => 900,
        "30" => 1800,
        "60" => 3600,
        "240" => 14400,
        "720" => 43200,
        "1D" => 86400,
        "3D" => 259200,
        "5D" => 432000,
        "1W" => 604800,
        "1M" => 2592000,
        _ => 60,
    }
}

/// Mirrors `validateSymbol`: errors when the price endpoint has no `data`.
async fn validate_symbol(client: &OrderlyClient, symbol: &str) -> Result<(), AppError> {
    let result = client.get_market_price(symbol).await?;
    if let Some(obj) = result.as_object() {
        match obj.get("data") {
            None => {
                return Err(super::fail_hints(
                    format!("Symbol not found: \"{symbol}\"."),
                    vec![super::SYMBOL_HINT.to_string()],
                ))
            }
            Some(Value::Null) => {
                return Err(super::fail_hints(
                    format!("Symbol not found: \"{symbol}\"."),
                    vec![super::SYMBOL_HINT.to_string()],
                ))
            }
            _ => {}
        }
    }
    Ok(())
}

/// Mirrors `Number(value)` for the string-or-number pairs the WS returns.
fn as_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
}

/// Mirrors `filterRows`: keeps only rows whose `symbol` matches.
fn filter_rows(result: &mut Value, symbol: Option<&str>) {
    let Some(symbol) = symbol else {
        return;
    };
    let Some(data) = result.get_mut("data") else {
        return;
    };
    if !data.is_object() {
        return;
    }
    let rows = data
        .get("rows")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();
    let filtered: Vec<Value> = rows
        .into_iter()
        .filter(|r| r.get("symbol").and_then(|s| s.as_str()) == Some(symbol))
        .collect();
    if let Some(map) = data.as_object_mut() {
        map.insert("rows".to_string(), Value::Array(filtered));
    }
}

pub async fn get_price(raw_input: &str, symbol: &str, ctx: Ctx) -> Result<(), AppError> {
    let client = OrderlyClient::new(ctx.network);
    let result = client.get_market_price(symbol).await?;

    if let Some(obj) = result.as_object() {
        if !obj.contains_key("data") || obj.get("data") == Some(&Value::Null) {
            return Err(super::fail_hints(
                format!("Symbol not found: \"{raw_input}\"."),
                vec![super::SYMBOL_HINT.to_string()],
            ));
        }
    }

    output(&result, ctx.format);
    Ok(())
}

pub async fn get_kline(
    symbol: &str,
    type_: &str,
    limit: Option<i64>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let valid_type = type_.to_lowercase();
    if !VALID_KLINE_TYPES.contains(&type_) {
        return Err(super::fail(format!(
            "Invalid kline type. Use one of: {}",
            VALID_KLINE_TYPES.join(", ")
        )));
    }

    let Some(tv_resolution) = kline_to_tv(&valid_type) else {
        return Err(super::fail(format!(
            "Kline type '{valid_type}' is not supported via public API."
        )));
    };

    let resolution_seconds = tv_resolution_seconds(tv_resolution);
    let count = limit.unwrap_or(100);
    let to = (super::now_ms() / 1000) as i64;
    let from = to - count * resolution_seconds;

    let client = OrderlyClient::new(ctx.network);
    let upper = symbol.to_uppercase();
    validate_symbol(&client, &upper).await?;

    let base_url = get_api_base_url(ctx.network);
    let url = format!(
        "{base_url}/v1/tv/history?symbol={upper}&resolution={tv_resolution}&from={from}&to={to}"
    );

    let response = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Msg(e.to_string()))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Api { status, body });
    }
    let data: Value = response
        .json()
        .await
        .map_err(|e| AppError::Msg(e.to_string()))?;

    let ts = data.get("t").and_then(|t| t.as_array());
    if data.get("s").and_then(|s| s.as_str()) != Some("ok")
        || ts.map(|t| t.is_empty()) != Some(false)
    {
        output(&obj(vec![("rows", Value::Array(vec![]))]), ctx.format);
        return Ok(());
    }
    let ts = ts.unwrap();

    let numbers = |key: &str| -> Vec<Option<f64>> {
        data.get(key)
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(|v| v.as_f64()).collect())
            .unwrap_or_default()
    };
    let opens = numbers("o");
    let highs = numbers("h");
    let lows = numbers("l");
    let closes = numbers("c");
    let volumes = numbers("v");
    let amounts = numbers("a");

    let pick = |list: &[Option<f64>], i: usize| -> Value {
        match list.get(i).copied().flatten() {
            Some(v) => crate::api::js_number(v),
            None => Value::Null,
        }
    };

    let rows: Vec<Value> = ts
        .iter()
        .enumerate()
        .filter_map(|(i, start_ts)| {
            let start_ts = start_ts.as_i64()?;
            Some(obj(vec![
                ("open", pick(&opens, i)),
                ("high", pick(&highs, i)),
                ("low", pick(&lows, i)),
                ("close", pick(&closes, i)),
                ("volume", pick(&volumes, i)),
                (
                    "amount",
                    if amounts.is_empty() {
                        crate::api::js_number(0.0)
                    } else {
                        pick(&amounts, i)
                    },
                ),
                ("symbol", Value::String(upper.clone())),
                ("type", Value::String(valid_type.clone())),
                (
                    "start_timestamp",
                    crate::api::js_number((start_ts * 1000) as f64),
                ),
                (
                    "end_timestamp",
                    crate::api::js_number(((start_ts + resolution_seconds) * 1000) as f64),
                ),
            ]))
        })
        .collect();

    output(&obj(vec![("rows", Value::Array(rows))]), ctx.format);
    Ok(())
}

pub async fn get_orderbook(symbol: &str, ctx: Ctx, depth: Option<i64>) -> Result<(), AppError> {
    if let Some(d) = depth {
        if d < 1 {
            return Err(super::fail("--depth must be a positive integer."));
        }
    }

    let upper = symbol.to_uppercase();
    let client = OrderlyClient::new(ctx.network);
    let price_check = client.get_market_price(&upper).await?;
    if let Some(obj) = price_check.as_object() {
        if !obj.contains_key("data") || obj.get("data") == Some(&Value::Null) {
            return Err(super::fail_hints(
                format!("Symbol not found: \"{symbol}\"."),
                vec![super::SYMBOL_HINT.to_string()],
            ));
        }
    }

    let snapshot = fetch_ws_snapshot(&upper, "orderbook", ctx.network, 10_000).await;
    let Some(data) = snapshot.data.filter(|_| snapshot.success) else {
        return Err(super::fail(
            snapshot
                .error
                .unwrap_or_else(|| "Failed to fetch orderbook".to_string()),
        ));
    };

    let levels = |key: &str| -> Vec<(f64, f64)> {
        data.get(key)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|entry| {
                        let pair = entry.as_array()?;
                        let price = pair.first().and_then(as_f64)?;
                        let quantity = pair.get(1).and_then(as_f64)?;
                        Some((price, quantity))
                    })
                    .collect()
            })
            .unwrap_or_default()
    };

    let asks_all = levels("asks");
    let bids_all = levels("bids");

    let limit = depth.map(|d| d as usize);
    let take = |list: &[(f64, f64)]| -> Vec<(f64, f64)> {
        match limit {
            Some(n) => list.iter().take(n).copied().collect(),
            None => list.to_vec(),
        }
    };
    let asks = take(&asks_all);
    let bids = take(&bids_all);

    if ctx.is_csv() {
        let mut rows: Vec<Value> = Vec::new();
        for (price, quantity) in &asks {
            rows.push(obj(vec![
                ("side", Value::String("ask".to_string())),
                ("price", crate::api::js_number(*price)),
                ("quantity", crate::api::js_number(*quantity)),
            ]));
        }
        for (price, quantity) in &bids {
            rows.push(obj(vec![
                ("side", Value::String("bid".to_string())),
                ("price", crate::api::js_number(*price)),
                ("quantity", crate::api::js_number(*quantity)),
            ]));
        }
        output(&obj(vec![("rows", Value::Array(rows))]), ctx.format);
    } else {
        let to_values = |list: &[(f64, f64)]| -> Value {
            Value::Array(
                list.iter()
                    .map(|(price, quantity)| {
                        obj(vec![
                            ("price", crate::api::js_number(*price)),
                            ("quantity", crate::api::js_number(*quantity)),
                        ])
                    })
                    .collect(),
            )
        };
        output(
            &obj(vec![("asks", to_values(&asks)), ("bids", to_values(&bids))]),
            ctx.format,
        );
    }
    Ok(())
}

pub async fn get_symbols(show_info: bool, ctx: Ctx) -> Result<(), AppError> {
    let client = OrderlyClient::new(ctx.network);
    let result = if show_info {
        client.get_symbols().await?
    } else {
        client.get_futures().await?
    };
    output(&result, ctx.format);
    Ok(())
}

pub async fn get_market_trades(symbol: &str, limit: Option<i64>, ctx: Ctx) -> Result<(), AppError> {
    let client = OrderlyClient::new(ctx.network);
    let upper = symbol.to_uppercase();
    validate_symbol(&client, &upper).await?;
    let result = client.get_market_trades(&upper, limit).await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn get_funding_rates(symbol: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let client = OrderlyClient::new(ctx.network);
    let mut result = client.get_funding_rates().await?;
    filter_rows(&mut result, symbol);
    output(&result, ctx.format);
    Ok(())
}

pub async fn get_price_changes(symbol: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let client = OrderlyClient::new(ctx.network);
    let mut result = client.get_price_changes().await?;
    filter_rows(&mut result, symbol);
    output(&result, ctx.format);
    Ok(())
}

pub async fn get_open_interest(symbol: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let client = OrderlyClient::new(ctx.network);
    if let Some(s) = symbol {
        validate_symbol(&client, &s.to_uppercase()).await?;
    }
    let mut result = client.get_open_interest().await?;
    filter_rows(&mut result, symbol);
    output(&result, ctx.format);
    Ok(())
}

pub async fn get_liquidated_positions(
    symbol: Option<&str>,
    page: Option<i64>,
    size: Option<i64>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let client = OrderlyClient::new(ctx.network);
    let result = client.get_liquidated_positions(symbol, page, size).await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn get_system_status(ctx: Ctx) -> Result<(), AppError> {
    let client = OrderlyClient::new(ctx.network);
    let result = client.get_system_info().await?;
    output(&result, ctx.format);
    Ok(())
}

/// Exposed for tests.
pub fn network_api_base(network: Network) -> &'static str {
    get_api_base_url(network)
}
