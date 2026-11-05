//! Orderly Predict (binary 5-minute BTC Up/Down rounds).
//!
//! The matching engine only understands the UP book. A DOWN buy at `d` is a
//! SELL on the UP book at `1 - d`; a DOWN sell is a reduce-only BUY at
//! `1 - d`. `--price` is always the price in the direction the trader chose.

use crate::account_select::create_authenticated_client;
use crate::api::{js_number, obj, OrderlyClient};
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::{output, unwrap_response};
use crate::ws::fetch_ws_snapshot;
use serde_json::Value;

pub const DIRECTIONS: &[&str] = &["UP", "DOWN"];
pub const PREDICT_ORDER_TYPES: &[&str] = &["LIMIT", "IOC", "POST_ONLY"];
pub const PREDICT_STATUSES: &[&str] = &["ACTIVE", "DELISTING", "RECYCLING", "DELISTED"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Up,
    Down,
}

impl Direction {
    fn parse(raw: &str) -> Result<Self, AppError> {
        match raw.to_ascii_uppercase().as_str() {
            "UP" => Ok(Direction::Up),
            "DOWN" => Ok(Direction::Down),
            _ => Err(super::fail_hints(
                format!("Invalid direction: \"{raw}\". Use UP or DOWN."),
                vec![
                    "Examples:".to_string(),
                    "  orderly predict-buy <symbol> UP 5 --price 0.53".to_string(),
                    "  orderly predict-buy <symbol> DOWN 5 --price 0.58".to_string(),
                ],
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Direction::Up => "UP",
            Direction::Down => "DOWN",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Buy,
    Sell,
}

impl Action {
    fn as_str(self) -> &'static str {
        match self {
            Action::Buy => "buy",
            Action::Sell => "sell",
        }
    }
}

struct RoundRef {
    data: Value,
    server_ts: u64,
}

struct BuiltOrder {
    body: Value,
    direction: Direction,
    direction_price: String,
    book_price: String,
    side: String,
    reduce_only: bool,
}

// ---------------------------------------------------------------------------
// Numeric / tick helpers
// ---------------------------------------------------------------------------

fn num_field(round: &Value, key: &str) -> Result<f64, AppError> {
    round
        .get(key)
        .and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .ok_or_else(|| super::fail(format!("Round info is missing {key}.")))
}

fn u64_of(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_f64().map(|f| f as u64))
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}

fn field_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(u64_of)
}

fn timestamp_of(value: &Value) -> Option<u64> {
    value.get("timestamp").and_then(u64_of)
}

fn tick_decimals(tick: f64) -> usize {
    let mut scaled = tick;
    let mut decimals = 0;
    while (scaled - scaled.round()).abs() > 1e-9 && decimals < 8 {
        scaled *= 10.0;
        decimals += 1;
    }
    decimals
}

fn format_tick(value: f64, tick: f64) -> String {
    format!("{:.*}", tick_decimals(tick), value)
}

fn is_on_tick(value: f64, tick: f64) -> bool {
    if tick <= 0.0 {
        return false;
    }
    let steps = value / tick;
    (steps - steps.round()).abs() < 1e-6
}

fn round_to_tick(value: f64, tick: f64) -> f64 {
    if tick <= 0.0 {
        return value;
    }
    (value / tick).round() * tick
}

fn floor_to_tick(value: f64, tick: f64) -> f64 {
    if tick <= 0.0 {
        return value;
    }
    round_to_tick((value / tick).floor() * tick, tick)
}

fn round_symbol(round: &Value) -> Result<&str, AppError> {
    round
        .get("symbol")
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| super::fail("Round info is missing symbol."))
}

fn side_for(direction: Direction, action: Action) -> &'static str {
    match (direction, action) {
        (Direction::Up, Action::Buy) | (Direction::Down, Action::Sell) => "BUY",
        (Direction::Up, Action::Sell) | (Direction::Down, Action::Buy) => "SELL",
    }
}

// ---------------------------------------------------------------------------
// Round state
// ---------------------------------------------------------------------------

fn is_current(round: &Value, server_ts: u64) -> bool {
    round.get("status").and_then(|s| s.as_str()) == Some("ACTIVE")
        && field_u64(round, "observation_start_at").is_some_and(|t| t <= server_ts)
        && field_u64(round, "expire_at").is_some_and(|t| server_ts < t)
}

fn is_open(round: &Value, server_ts: u64) -> bool {
    round.get("status").and_then(|s| s.as_str()) == Some("ACTIVE")
        && field_u64(round, "expire_at").is_some_and(|t| server_ts < t)
}

fn annotate_round(round: &Value, server_ts: u64) -> Value {
    let mut out = round.clone();
    let Some(object) = out.as_object_mut() else {
        return out;
    };
    let status = object
        .get("status")
        .and_then(|s| s.as_str())
        .unwrap_or_default();
    let start = object
        .get("observation_start_at")
        .and_then(u64_of)
        .unwrap_or(0);
    let expire = object.get("expire_at").and_then(u64_of).unwrap_or(0);
    let has_result = object.get("result_committed_at").and_then(u64_of).is_some();

    let phase = if has_result {
        if status == "DELISTED" {
            "ended"
        } else {
            "result_published"
        }
    } else if status == "DELISTED"
        || status == "RECYCLING"
        || status == "DELISTING"
        || (status == "ACTIVE" && server_ts >= expire)
    {
        if status == "DELISTED" {
            "ended"
        } else {
            "settling"
        }
    } else if status == "ACTIVE" && server_ts < start {
        "early_trading"
    } else if status == "ACTIVE" && start <= server_ts && server_ts < expire {
        "observing"
    } else {
        "ended"
    };

    object.insert("phase".to_string(), Value::String(phase.to_string()));
    object.insert(
        "is_current".to_string(),
        Value::Bool(is_current(round, server_ts)),
    );
    object.insert(
        "is_open".to_string(),
        Value::Bool(is_open(round, server_ts)),
    );
    object.insert(
        "seconds_to_expiry".to_string(),
        js_number((expire.saturating_sub(server_ts) / 1000) as f64),
    );
    out
}

fn round_sort_key(round: &Value) -> (u8, u64) {
    let status = round
        .get("status")
        .and_then(|s| s.as_str())
        .unwrap_or_default();
    let expire = field_u64(round, "expire_at").unwrap_or(u64::MAX);
    if status == "ACTIVE" {
        (0, expire)
    } else {
        (1, u64::MAX.saturating_sub(expire))
    }
}

fn validate_status(raw: &str) -> Result<String, AppError> {
    let upper = raw.to_ascii_uppercase();
    if PREDICT_STATUSES.contains(&upper.as_str()) {
        Ok(upper)
    } else {
        Err(super::fail(format!(
            "Invalid round status: \"{raw}\". Use one of: {}.",
            PREDICT_STATUSES.join(", ")
        )))
    }
}

async fn fetch_round(client: &OrderlyClient, symbol: &str) -> Result<RoundRef, AppError> {
    let raw = match client.get_predict_round(symbol).await {
        Ok(raw) => raw,
        Err(AppError::Api { status, body })
            if (400..500).contains(&status) && body.contains("binary round not found") =>
        {
            return Err(super::fail_hints(
                format!("Predict round not found: {symbol}."),
                vec![
                    "Run `orderly predict-rounds` to list recent rounds.".to_string(),
                    "Round symbols are permanent; never construct or guess them.".to_string(),
                ],
            ));
        }
        Err(error) => return Err(error),
    };
    let server_ts = timestamp_of(&raw).unwrap_or_else(super::now_ms);
    if raw.get("success").and_then(|s| s.as_bool()) != Some(true) {
        let message = raw
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Predict round not found");
        return Err(super::fail_hints(
            message.to_string(),
            vec![
                "Run `orderly predict-rounds` to list recent Predict rounds.".to_string(),
                "Round symbols are permanent; never construct or guess them.".to_string(),
            ],
        ));
    }
    let data = raw
        .get("data")
        .cloned()
        .filter(|d| !d.is_null())
        .ok_or_else(|| super::fail("Predict round not found."))?;
    Ok(RoundRef { data, server_ts })
}

async fn current_round(client: &OrderlyClient) -> Result<RoundRef, AppError> {
    let raw = client.get_predict_rounds().await?;
    let server_ts = timestamp_of(&raw).unwrap_or_else(super::now_ms);
    if raw.get("success").and_then(|s| s.as_bool()) != Some(true) {
        let message = raw
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Could not load Predict rounds");
        return Err(super::fail(message.to_string()));
    }
    let rows = raw
        .get("data")
        .and_then(|d| d.get("rows"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let current = rows.iter().find(|r| is_current(r, server_ts)).cloned();
    let next = rows
        .iter()
        .filter(|r| {
            r.get("status").and_then(|s| s.as_str()) == Some("ACTIVE")
                && field_u64(r, "observation_start_at").is_some_and(|t| t > server_ts)
        })
        .min_by_key(|r| field_u64(r, "observation_start_at").unwrap_or(u64::MAX))
        .cloned();

    let data = current.or(next).ok_or_else(|| {
        super::fail_hints(
            "No active Predict round right now.",
            vec!["Run `orderly predict-rounds` to see upcoming rounds.".to_string()],
        )
    })?;
    Ok(RoundRef { data, server_ts })
}

fn check_tradable(round: &Value, server_ts: u64) -> Result<(), AppError> {
    let symbol = round_symbol(round)?;
    let status = round
        .get("status")
        .and_then(|s| s.as_str())
        .unwrap_or_default();
    if status != "ACTIVE" {
        return Err(super::fail_hints(
            format!("Round {symbol} is not ACTIVE (status: {status})."),
            vec!["Run `orderly predict-rounds --current` to find a tradable round.".to_string()],
        ));
    }
    if let Some(expire) = field_u64(round, "expire_at") {
        if server_ts >= expire {
            return Err(super::fail_hints(
                format!("Round {symbol} expired at {expire}; orders are no longer accepted."),
                vec!["Run `orderly predict-rounds` to find a tradable round.".to_string()],
            ));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Order construction
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn build_order(
    round: &Value,
    direction: Direction,
    action: Action,
    shares: f64,
    direction_price: f64,
    order_type: &str,
    client_order_id: Option<&str>,
    post_only_adjust: bool,
) -> Result<BuiltOrder, AppError> {
    let quote_min = num_field(round, "quote_min")?;
    let quote_max = num_field(round, "quote_max")?;
    let quote_tick = num_field(round, "quote_tick")?;
    let base_min = num_field(round, "base_min")?;
    let base_max = num_field(round, "base_max")?;
    let base_tick = num_field(round, "base_tick")?;
    let min_notional = num_field(round, "min_notional")?;

    if quote_tick <= 0.0 || base_tick <= 0.0 {
        return Err(super::fail("Round info has an invalid tick size."));
    }

    let order_type = order_type.to_ascii_uppercase();
    if !PREDICT_ORDER_TYPES.contains(&order_type.as_str()) {
        return Err(super::fail_hints(
            format!("Invalid Predict order type: \"{order_type}\". Use LIMIT, IOC, or POST_ONLY."),
            vec!["MARKET, FOK, BID and ASK are not supported for Orderly Predict.".to_string()],
        ));
    }
    if post_only_adjust && order_type != "POST_ONLY" {
        return Err(super::fail(
            "--post-only-adjust is only valid with --type POST_ONLY.",
        ));
    }

    if !shares.is_finite() || shares <= 0.0 {
        return Err(super::fail("Shares must be a positive number."));
    }
    if !is_on_tick(shares, base_tick) {
        return Err(super::fail(format!(
            "Shares {shares} are not on the {base_tick} tick."
        )));
    }
    if shares < base_min || shares > base_max {
        return Err(super::fail(format!(
            "Shares must be between {base_min} and {base_max}."
        )));
    }

    if !direction_price.is_finite() {
        return Err(super::fail("Price must be a number."));
    }
    if !is_on_tick(direction_price, quote_tick) {
        return Err(super::fail(format!(
            "Price {direction_price} is not on the {quote_tick} tick."
        )));
    }
    if direction_price < quote_min || direction_price > quote_max {
        return Err(super::fail(format!(
            "Price {direction_price} is outside the round range {quote_min}-{quote_max}."
        )));
    }

    let book_price = round_to_tick(
        match direction {
            Direction::Up => direction_price,
            Direction::Down => 1.0 - direction_price,
        },
        quote_tick,
    );
    if !is_on_tick(book_price, quote_tick) || book_price < quote_min || book_price > quote_max {
        return Err(super::fail(format!(
            "Converted UP-book price {book_price} is outside the round range {quote_min}-{quote_max}."
        )));
    }

    let notional = book_price * shares;
    if notional + 1e-9 < min_notional {
        let mut hints = vec![
            "Increase the share quantity.".to_string(),
            "For DOWN orders the minimum is always checked against the UP-book price (1 - DOWN price).".to_string(),
        ];
        if action == Action::Sell {
            hints.push(
                "If this is a full close, the position is too small to close at this price; it can settle at expiry."
                    .to_string(),
            );
        }
        return Err(super::fail_hints(
            format!(
                "Order notional {notional} is below the round minimum {min_notional} (UP-book {book_price} x {shares} shares)."
            ),
            hints,
        ));
    }

    let side = side_for(direction, action);
    let reduce_only = action == Action::Sell;
    let mut pairs: Vec<(&str, Value)> = vec![
        ("symbol", Value::String(round_symbol(round)?.to_string())),
        ("order_type", Value::String(order_type)),
        ("side", Value::String(side.to_string())),
        (
            "order_price",
            Value::String(format_tick(book_price, quote_tick)),
        ),
        (
            "order_quantity",
            Value::String(format_tick(shares, base_tick)),
        ),
        ("margin_mode", Value::String("ISOLATED".to_string())),
    ];
    if reduce_only {
        pairs.push(("reduce_only", Value::Bool(true)));
    }
    if let Some(id) = client_order_id.filter(|v| !v.is_empty()) {
        pairs.push(("client_order_id", Value::String(id.to_string())));
    }
    if post_only_adjust {
        pairs.push(("post_only_adjust", Value::Bool(true)));
    }

    Ok(BuiltOrder {
        body: obj(pairs),
        direction,
        direction_price: format_tick(direction_price, quote_tick),
        book_price: format_tick(book_price, quote_tick),
        side: side.to_string(),
        reduce_only,
    })
}

fn dry_run_note(built: &BuiltOrder, action: Action) -> String {
    if built.direction == Direction::Down {
        format!(
            "DOWN {} @ {} is sent to the UP book as {} @ {}. margin_mode is always ISOLATED.",
            action.as_str(),
            built.direction_price,
            built.side,
            built.book_price
        )
    } else {
        format!(
            "UP {} on the UP book at {}. margin_mode is always ISOLATED.",
            action.as_str(),
            built.book_price
        )
    }
}

fn annotate_order_response(raw: &Value, built: &BuiltOrder) -> Value {
    if raw.get("success").and_then(|s| s.as_bool()) != Some(true) {
        return raw.clone();
    }
    let mut value = unwrap_response(raw);
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "direction".to_string(),
            Value::String(built.direction.as_str().to_string()),
        );
        object.insert(
            "direction_price".to_string(),
            Value::String(built.direction_price.clone()),
        );
        object.insert(
            "book_price".to_string(),
            Value::String(built.book_price.clone()),
        );
        object.insert("reduce_only".to_string(), Value::Bool(built.reduce_only));
    }
    value
}

fn value_to_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}

async fn fetch_position_qty(client: &OrderlyClient, symbol: &str) -> Result<f64, AppError> {
    // Predict positions are always ISOLATED. The single-position endpoint
    // defaults to CROSS, so passing the filter is required.
    if let Ok(raw) = client
        .get_position_with_margin_mode(symbol, "ISOLATED")
        .await
    {
        if raw.get("success").and_then(|s| s.as_bool()) == Some(true) {
            if let Some(qty) = raw
                .get("data")
                .and_then(|d| d.get("position_qty"))
                .and_then(value_to_f64)
            {
                if qty != 0.0 {
                    return Ok(qty);
                }
            }
        }
    }

    // Fall back to the product-filtered positions list if the single-position
    // view is stale or unavailable.
    for product_type in [Some("BINARY"), None] {
        let raw = client.get_positions(product_type).await?;
        let Some(rows) = raw
            .get("data")
            .and_then(|d| d.get("rows"))
            .and_then(|r| r.as_array())
        else {
            continue;
        };
        if let Some(qty) = rows
            .iter()
            .find(|row| row.get("symbol").and_then(|s| s.as_str()) == Some(symbol))
            .and_then(|row| row.get("position_qty"))
            .and_then(value_to_f64)
        {
            return Ok(qty);
        }
    }
    Ok(0.0)
}

async fn check_position(
    client: &OrderlyClient,
    symbol: &str,
    direction: Direction,
    shares: f64,
) -> Result<(), AppError> {
    let qty = fetch_position_qty(client, symbol).await?;
    if qty == 0.0 {
        return Err(super::fail_hints(
            format!("No open Predict position for {symbol}."),
            vec![
                "Run `orderly positions-list --product-type BINARY` to see positions.".to_string(),
            ],
        ));
    }
    let position_direction = if qty > 0.0 {
        Direction::Up
    } else {
        Direction::Down
    };
    if position_direction != direction {
        return Err(super::fail_hints(
            format!(
                "The open position is {}, not {}.",
                position_direction.as_str(),
                direction.as_str()
            ),
            vec![
                "Use predict-sell with the direction of the open position, or predict-close."
                    .to_string(),
            ],
        ));
    }
    let size = qty.abs();
    if shares > size + 1e-9 {
        return Err(super::fail(format!(
            "Shares {shares} exceed the position size {size}."
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Order book helpers
// ---------------------------------------------------------------------------

fn parse_number(value: &Value) -> Option<f64> {
    value_to_f64(value)
}

fn parse_levels(value: Option<&Value>) -> Vec<(f64, f64)> {
    value
        .and_then(|v| v.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    if let Some(pair) = entry.as_array() {
                        let price = pair.first().and_then(parse_number)?;
                        let quantity = pair.get(1).and_then(parse_number)?;
                        Some((price, quantity))
                    } else {
                        let object = entry.as_object()?;
                        let price = object.get("price").and_then(parse_number)?;
                        let quantity = object.get("quantity").and_then(parse_number)?;
                        Some((price, quantity))
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn ensure_down_side(provided: Vec<(f64, f64)>, opposite: &[(f64, f64)]) -> Vec<(f64, f64)> {
    if !provided.is_empty() {
        return provided;
    }
    opposite
        .iter()
        .map(|(price, quantity)| (1.0 - price, *quantity))
        .collect()
}

fn best_price(levels: &[(f64, f64)]) -> Value {
    levels
        .first()
        .map(|(price, _)| js_number(*price))
        .unwrap_or(Value::Null)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

pub async fn rounds(
    status: Option<&str>,
    current: bool,
    limit: Option<usize>,
    all: bool,
    ctx: Ctx,
) -> Result<(), AppError> {
    let status = match status.filter(|s| !s.is_empty()) {
        Some(status) => Some(validate_status(status)?),
        None => None,
    };
    if let Some(limit) = limit {
        if limit == 0 {
            return Err(super::fail("--limit must be a positive integer."));
        }
    }

    let client = OrderlyClient::new(ctx.network);
    let raw = client.get_predict_rounds().await?;
    let server_ts = timestamp_of(&raw).unwrap_or_else(super::now_ms);
    if raw.get("success").and_then(|s| s.as_bool()) != Some(true) {
        let message = raw
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Could not load Predict rounds");
        return Err(super::fail(message.to_string()));
    }

    let mut rows = raw
        .get("data")
        .and_then(|d| d.get("rows"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();
    if let Some(status) = status {
        rows.retain(|row| row.get("status").and_then(|s| s.as_str()) == Some(status.as_str()));
    }
    if current {
        rows.retain(|row| is_current(row, server_ts));
    }
    // The API returns newest-first. For a rounds picker, show the soonest
    // expiring ACTIVE rounds first, then the most recently ended rounds.
    rows.sort_by_key(round_sort_key);
    let max = if all {
        usize::MAX
    } else {
        limit.unwrap_or(20).min(300)
    };
    rows.truncate(max);

    let rows: Vec<Value> = rows
        .iter()
        .map(|round| annotate_round(round, server_ts))
        .collect();
    output(
        &obj(vec![
            ("server_timestamp", js_number(server_ts as f64)),
            ("rows", Value::Array(rows)),
        ]),
        ctx.format,
    );
    Ok(())
}

pub async fn round(symbol: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let client = OrderlyClient::new(ctx.network);
    let round = match symbol {
        Some(symbol) => fetch_round(&client, symbol).await?,
        None => current_round(&client).await?,
    };

    let mut value = annotate_round(&round.data, round.server_ts);
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "server_timestamp".to_string(),
            js_number(round.server_ts as f64),
        );
    }
    output(&value, ctx.format);
    Ok(())
}

pub async fn orderbook(symbol: Option<&str>, depth: Option<i64>, ctx: Ctx) -> Result<(), AppError> {
    if let Some(depth) = depth {
        if depth < 1 {
            return Err(super::fail("--depth must be a positive integer."));
        }
    }

    let client = OrderlyClient::new(ctx.network);
    let round = match symbol {
        Some(symbol) => fetch_round(&client, symbol).await?,
        None => current_round(&client).await?,
    };
    let symbol = round_symbol(&round.data)?.to_string();

    let snapshot = fetch_ws_snapshot(&symbol, "orderbook", ctx.network, 10_000).await;
    let Some(data) = snapshot.data.filter(|_| snapshot.success) else {
        return Err(super::fail(snapshot.error.unwrap_or_else(|| {
            "Failed to fetch Predict orderbook".to_string()
        })));
    };

    let asks = parse_levels(data.get("asks"));
    let bids = parse_levels(data.get("bids"));
    let down_asks = ensure_down_side(parse_levels(data.get("down_asks")), &bids);
    let down_bids = ensure_down_side(parse_levels(data.get("down_bids")), &asks);

    let best = obj(vec![
        ("up_bid", best_price(&bids)),
        ("up_ask", best_price(&asks)),
        ("down_bid", best_price(&down_bids)),
        ("down_ask", best_price(&down_asks)),
    ]);
    let timestamp = data
        .get("timestamp")
        .and_then(u64_of)
        .unwrap_or_else(super::now_ms);

    let take = |levels: &[(f64, f64)]| -> Vec<(f64, f64)> {
        match depth {
            Some(depth) => levels.iter().take(depth as usize).copied().collect(),
            None => levels.to_vec(),
        }
    };
    let asks = take(&asks);
    let bids = take(&bids);
    let down_asks = take(&down_asks);
    let down_bids = take(&down_bids);

    if ctx.is_csv() {
        let mut rows: Vec<Value> = Vec::new();
        for (direction, side, levels) in [
            ("UP", "ask", &asks),
            ("UP", "bid", &bids),
            ("DOWN", "ask", &down_asks),
            ("DOWN", "bid", &down_bids),
        ] {
            for (price, quantity) in levels {
                rows.push(obj(vec![
                    ("symbol", Value::String(symbol.clone())),
                    ("direction", Value::String(direction.to_string())),
                    ("side", Value::String(side.to_string())),
                    ("price", js_number(*price)),
                    ("quantity", js_number(*quantity)),
                ]));
            }
        }
        output(&obj(vec![("rows", Value::Array(rows))]), ctx.format);
    } else {
        let to_values = |levels: &[(f64, f64)]| -> Value {
            Value::Array(
                levels
                    .iter()
                    .map(|(price, quantity)| {
                        obj(vec![
                            ("price", js_number(*price)),
                            ("quantity", js_number(*quantity)),
                        ])
                    })
                    .collect(),
            )
        };
        output(
            &obj(vec![
                ("symbol", Value::String(symbol)),
                ("timestamp", js_number(timestamp as f64)),
                ("best", best),
                ("asks", to_values(&asks)),
                ("bids", to_values(&bids)),
                ("down_asks", to_values(&down_asks)),
                ("down_bids", to_values(&down_bids)),
            ]),
            ctx.format,
        );
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn place(
    symbol: &str,
    direction: &str,
    shares: &str,
    price: Option<&str>,
    order_type: Option<&str>,
    client_order_id: Option<&str>,
    post_only_adjust: bool,
    action: Action,
    dry_run: bool,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let direction = Direction::parse(direction)?;
    let order_type = order_type.unwrap_or("LIMIT").to_ascii_uppercase();
    let Some(price) = price.filter(|p| !p.is_empty()) else {
        return Err(super::fail(format!(
            "Price is required for Predict {} orders. Use --price <0.01-0.99>.",
            action.as_str()
        )));
    };
    let price = super::js_number(price);
    if price.is_nan() || price <= 0.0 {
        return Err(super::fail("Price must be a positive number."));
    }
    let shares = super::js_number(shares);
    if shares.is_nan() || shares <= 0.0 {
        return Err(super::fail("Shares must be a positive number."));
    }

    let public_client = OrderlyClient::new(ctx.network);
    let round = fetch_round(&public_client, symbol).await?;
    check_tradable(&round.data, round.server_ts)?;
    let built = build_order(
        &round.data,
        direction,
        action,
        shares,
        price,
        &order_type,
        client_order_id,
        post_only_adjust,
    )?;

    if dry_run {
        let note = dry_run_note(&built, action);
        return super::dry_run::emit(
            &OrderlyClient::place_order_spec(&built.body),
            Some(&note),
            &["GET /v1/public/binary/info/{symbol} (public)"],
        );
    }

    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    if action == Action::Sell {
        check_position(&client, symbol, direction, shares).await?;
    }
    let raw = client.place_order(&built.body).await?;
    output(&annotate_order_response(&raw, &built), ctx.format);
    Ok(())
}

pub async fn close(
    symbol: &str,
    shares: Option<&str>,
    protect_ticks: i64,
    dry_run: bool,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    if protect_ticks < 0 {
        return Err(super::fail("--protect-ticks must be zero or positive."));
    }
    if protect_ticks > 100 {
        return Err(super::fail("--protect-ticks must be 100 or less."));
    }

    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let round = fetch_round(&client, symbol).await?;
    check_tradable(&round.data, round.server_ts)?;

    let qty = fetch_position_qty(&client, symbol).await?;
    if qty == 0.0 {
        return Err(super::fail_hints(
            format!("No open Predict position for {symbol}."),
            vec![
                "Run `orderly positions-list --product-type BINARY` to see positions.".to_string(),
            ],
        ));
    }
    let direction = if qty > 0.0 {
        Direction::Up
    } else {
        Direction::Down
    };
    let base_tick = num_field(&round.data, "base_tick")?;
    let quote_tick = num_field(&round.data, "quote_tick")?;
    let quote_min = num_field(&round.data, "quote_min")?;
    let absolute_qty = qty.abs();

    let size = match shares.filter(|s| !s.is_empty()) {
        Some(raw) => {
            let parsed = super::js_number(raw);
            if parsed.is_nan() || parsed <= 0.0 {
                return Err(super::fail("--shares must be a positive number."));
            }
            if parsed > absolute_qty + 1e-9 {
                return Err(super::fail(format!(
                    "--shares {parsed} exceeds the position size {absolute_qty}."
                )));
            }
            if !is_on_tick(parsed, base_tick) {
                return Err(super::fail(format!(
                    "--shares {parsed} is not on the {base_tick} tick."
                )));
            }
            parsed
        }
        None => floor_to_tick(absolute_qty, base_tick),
    };
    if size <= 0.0 {
        return Err(super::fail(format!(
            "Position size {absolute_qty} is below the {base_tick} tick."
        )));
    }

    let snapshot = fetch_ws_snapshot(symbol, "orderbook", ctx.network, 10_000).await;
    let Some(data) = snapshot.data.filter(|_| snapshot.success) else {
        return Err(super::fail_hints(
            snapshot
                .error
                .unwrap_or_else(|| "Failed to fetch Predict orderbook".to_string()),
            vec![
                "Use `orderly predict-sell` with an explicit price if the order book is unavailable."
                    .to_string(),
            ],
        ));
    };
    let asks = parse_levels(data.get("asks"));
    let bids = parse_levels(data.get("bids"));

    let direction_price = match direction {
        Direction::Up => {
            let Some((best_bid, _)) = bids.first() else {
                return Err(super::fail("No bids to close an UP position against."));
            };
            (best_bid - protect_ticks as f64 * quote_tick).max(quote_min)
        }
        Direction::Down => {
            let Some((best_ask, _)) = asks.first() else {
                return Err(super::fail("No asks to close a DOWN position against."));
            };
            ((1.0 - best_ask) - protect_ticks as f64 * quote_tick).max(quote_min)
        }
    };

    let built = build_order(
        &round.data,
        direction,
        Action::Sell,
        size,
        direction_price,
        "IOC",
        None,
        false,
    )?;

    if dry_run {
        let note = format!(
            "Protection price = {} ticks beyond the best {}; the live command sends an IOC reduce-only order. {}",
            protect_ticks,
            if direction == Direction::Up { "bid" } else { "ask" },
            dry_run_note(&built, Action::Sell)
        );
        return super::dry_run::emit(
            &OrderlyClient::place_order_spec(&built.body),
            Some(&note),
            &[
                "GET /v1/position/{symbol} (authenticated)",
                "<symbol>@orderbook (WebSocket)",
            ],
        );
    }

    let raw = client.place_order(&built.body).await?;
    output(&annotate_order_response(&raw, &built), ctx.format);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn round() -> Value {
        json!({
            "symbol": "PERP_BTC5M2611050910_USDC",
            "status": "ACTIVE",
            "observation_start_at": 1_000_000,
            "expire_at": 1_300_000,
            "quote_min": 0.01,
            "quote_max": 0.99,
            "quote_tick": 0.01,
            "base_min": 0.01,
            "base_max": 10000,
            "base_tick": 0.01,
            "min_notional": 1,
            "result_committed_at": null,
        })
    }

    #[test]
    fn down_buy_is_sell_on_up_book() {
        let built = build_order(
            &round(),
            Direction::Down,
            Action::Buy,
            5.0,
            0.58,
            "IOC",
            None,
            false,
        )
        .unwrap();
        assert_eq!(built.body["side"], "SELL");
        assert_eq!(built.body["order_price"], "0.42");
        assert_eq!(built.body["order_quantity"], "5.00");
        assert_eq!(built.body["margin_mode"], "ISOLATED");
        assert_eq!(built.direction_price, "0.58");
        assert_eq!(built.book_price, "0.42");
        assert!(!built.reduce_only);
    }

    #[test]
    fn down_sell_is_reduce_only_buy() {
        let built = build_order(
            &round(),
            Direction::Down,
            Action::Sell,
            5.0,
            0.47,
            "LIMIT",
            None,
            false,
        )
        .unwrap();
        assert_eq!(built.body["side"], "BUY");
        assert_eq!(built.body["order_price"], "0.53");
        assert_eq!(built.body["reduce_only"], true);
    }

    #[test]
    fn rejects_off_tick_price() {
        assert!(build_order(
            &round(),
            Direction::Up,
            Action::Buy,
            5.0,
            0.531,
            "LIMIT",
            None,
            false
        )
        .is_err());
    }

    #[test]
    fn rejects_below_min_notional() {
        assert!(build_order(
            &round(),
            Direction::Up,
            Action::Buy,
            1.0,
            0.53,
            "LIMIT",
            None,
            false
        )
        .is_err());
    }

    #[test]
    fn rejects_market_type() {
        assert!(build_order(
            &round(),
            Direction::Up,
            Action::Buy,
            5.0,
            0.53,
            "MARKET",
            None,
            false
        )
        .is_err());
    }

    #[test]
    fn phase_derivation() {
        let round = round();
        assert_eq!(annotate_round(&round, 999_000)["phase"], "early_trading");
        assert_eq!(annotate_round(&round, 1_100_000)["phase"], "observing");
        assert_eq!(annotate_round(&round, 1_400_000)["phase"], "settling");

        let mut settled = round;
        settled["result_committed_at"] = json!(1_500_000);
        assert_eq!(
            annotate_round(&settled, 1_500_000)["phase"],
            "result_published"
        );
    }

    #[test]
    fn derives_down_book_from_up_book() {
        let bids = vec![(0.42, 10.0), (0.40, 5.0)];
        let asks = vec![(0.53, 8.0)];
        let down_asks = ensure_down_side(Vec::new(), &bids);
        let down_bids = ensure_down_side(Vec::new(), &asks);
        assert!((down_asks[0].0 - 0.58).abs() < 1e-9);
        assert!((down_asks[1].0 - 0.60).abs() < 1e-9);
        assert!((down_bids[0].0 - 0.47).abs() < 1e-9);
    }

    #[test]
    fn tick_helpers() {
        assert!(is_on_tick(0.53, 0.01));
        assert!(!is_on_tick(0.531, 0.01));
        assert_eq!(format_tick(0.5, 0.01), "0.50");
        assert!((floor_to_tick(5.009, 0.01) - 5.0).abs() < 1e-9);
    }
}
