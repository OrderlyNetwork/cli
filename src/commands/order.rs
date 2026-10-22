//! `src/commands/order.ts`

use crate::account_select::create_authenticated_client;
use crate::api::{js_number, obj};
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::{normalize_symbol, output};
use serde_json::Value;

pub const VALID_ORDER_TYPES: [&str; 7] =
    ["LIMIT", "MARKET", "IOC", "FOK", "POST_ONLY", "ASK", "BID"];
pub const PRICE_REQUIRED_TYPES: [&str; 4] = ["LIMIT", "IOC", "FOK", "POST_ONLY"];

/// JS `String(value)` for the loosely typed batch-order fields.
pub fn js_string_of(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        Value::Number(n) => crate::commands::settle::stringify_number(&Value::Number(n.clone())),
        Value::Array(items) => items.iter().map(js_string_of).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

fn nullish<'a>(source: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    for key in keys {
        if let Some(value) = source.get(*key) {
            if !value.is_null() {
                return Some(value);
            }
        }
    }
    None
}

/// JS `Number(str)` wrapper returning `f64::NAN` for unparseable input.
fn to_number(value: &Value) -> f64 {
    match value {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => crate::commands::js_number(s),
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        _ => f64::NAN,
    }
}

fn number_value(value: f64) -> Value {
    if value.is_nan() {
        Value::Null
    } else {
        js_number(value)
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn place(
    symbol: &str,
    side: &str,
    type_: &str,
    quantity: &str,
    price: Option<&str>,
    client_order_id: Option<&str>,
    reduce_only: bool,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let valid_side = side.to_uppercase();
    if valid_side != "BUY" && valid_side != "SELL" {
        return Err(super::fail("Invalid side. Use BUY or SELL."));
    }

    let valid_type = type_.to_uppercase();
    if !VALID_ORDER_TYPES.contains(&valid_type.as_str()) {
        return Err(super::fail(format!(
            "Invalid order type. Use one of: {}",
            VALID_ORDER_TYPES.join(", ")
        )));
    }

    let price = price.filter(|p| !p.is_empty());
    if PRICE_REQUIRED_TYPES.contains(&valid_type.as_str()) && price.is_none() {
        return Err(super::fail(format!(
            "Price is required for {valid_type} orders."
        )));
    }

    let num_qty = super::js_number(quantity);
    if num_qty.is_nan() || num_qty <= 0.0 {
        return Err(super::fail("Quantity must be a positive number."));
    }

    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;

    let mut pairs: Vec<(&str, Value)> = vec![
        ("symbol", Value::String(symbol.to_uppercase())),
        ("order_type", Value::String(valid_type)),
        ("side", Value::String(valid_side)),
        ("order_quantity", Value::String(quantity.to_string())),
    ];
    if let Some(p) = price {
        pairs.push(("order_price", Value::String(p.to_string())));
    }
    if let Some(id) = client_order_id.filter(|v| !v.is_empty()) {
        pairs.push(("client_order_id", Value::String(id.to_string())));
    }
    if reduce_only {
        pairs.push(("reduce_only", Value::Bool(true)));
    }

    let result = client.place_order(&obj(pairs)).await?;

    let success = result.get("success").and_then(|s| s.as_bool()) == Some(true);
    let order_data = if success && result.get("data").map(|d| !d.is_null()).unwrap_or(false) {
        result.get("data").cloned().unwrap_or(Value::Null)
    } else {
        result.clone()
    };

    if let Some(order_id) = order_data.get("order_id").filter(|v| !v.is_null()) {
        let id = crate::commands::settle::stringify_number(order_id);
        match client.get_order_by_order_id(&id).await {
            Ok(details) => output(&details, ctx.format),
            Err(_) => output(&result, ctx.format),
        }
    } else {
        output(&result, ctx.format);
    }
    Ok(())
}

pub async fn cancel(
    order_id: &str,
    symbol: Option<&str>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;

    let mut order_symbol = symbol.filter(|s| !s.is_empty()).map(String::from);
    if order_symbol.is_none() {
        let order_res = client.get_order(order_id).await?;
        let success = order_res.get("success").and_then(|s| s.as_bool()) == Some(true);
        let data = order_res.get("data").filter(|d| !d.is_null()).cloned();
        let Some(data) = data.filter(|_| success) else {
            return Err(super::fail(format!("Order {order_id} not found.")));
        };
        order_symbol = data
            .get("symbol")
            .and_then(|s| s.as_str())
            .map(String::from);
    }

    let result = client
        .cancel_order(order_id, order_symbol.as_deref())
        .await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn edit(
    order_id: &str,
    symbol: Option<&str>,
    price: Option<&str>,
    quantity: Option<&str>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let price = price.filter(|p| !p.is_empty());
    let quantity = quantity.filter(|q| !q.is_empty());

    if price.is_none() && quantity.is_none() {
        return Err(super::fail_hints(
            "At least one of --price or --quantity is required to edit an order.",
            vec![
                "Examples:".to_string(),
                "  orderly order-edit 123456 --price 3500".to_string(),
                "  orderly order-edit 123456 --quantity 0.02".to_string(),
                "  orderly order-edit 123456 --price 3500 --quantity 0.02".to_string(),
            ],
        ));
    }

    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;

    let order_res = client.get_order(order_id).await?;
    let success = order_res.get("success").and_then(|s| s.as_bool()) == Some(true);
    let data = order_res.get("data").filter(|d| !d.is_null()).cloned();
    let Some(data) = data.filter(|_| success) else {
        return Err(super::fail(format!("Order {order_id} not found.")));
    };

    let order_symbol = symbol
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| {
            data.get("symbol")
                .and_then(|s| s.as_str())
                .map(String::from)
        });

    let order_type = data.get("type").cloned().unwrap_or(Value::Null);
    let order_side = data.get("side").cloned().unwrap_or(Value::Null);
    let existing_price = data.get("price").filter(|p| !p.is_null()).map(js_string_of);
    let existing_quantity = data
        .get("quantity")
        .filter(|q| !q.is_null())
        .map(js_string_of);
    let existing_visible_qty = data
        .get("visible_quantity")
        .filter(|v| !v.is_null())
        .and_then(|v| v.as_f64());
    let existing_client_order_id = data
        .get("client_order_id")
        .filter(|v| !v.is_null())
        .map(js_string_of);

    if let Some(p) = price {
        let num_price = super::js_number(p);
        if num_price.is_nan() || num_price <= 0.0 {
            return Err(super::fail("Price must be a positive number."));
        }
    }
    if let Some(q) = quantity {
        let num_qty = super::js_number(q);
        if num_qty.is_nan() || num_qty <= 0.0 {
            return Err(super::fail("Quantity must be a positive number."));
        }
    }

    let order_price = match price {
        Some(p) => number_value(super::js_number(p)),
        None => number_value(
            existing_price
                .as_deref()
                .map(super::js_number)
                .unwrap_or(f64::NAN),
        ),
    };
    let order_quantity = match quantity {
        Some(q) => number_value(super::js_number(q)),
        None => number_value(
            existing_quantity
                .as_deref()
                .map(super::js_number)
                .unwrap_or(f64::NAN),
        ),
    };

    let mut pairs: Vec<(&str, Value)> = vec![
        ("order_type", order_type),
        ("side", order_side),
        ("order_price", order_price),
        ("order_quantity", order_quantity),
    ];
    if let Some(v) = existing_visible_qty {
        pairs.push(("visible_quantity", number_value(v)));
    }
    if let Some(id) = existing_client_order_id {
        pairs.push(("client_order_id", Value::String(id)));
    }

    let result = client
        .edit_order(order_id, &obj(pairs), order_symbol.as_deref().unwrap_or(""))
        .await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn cancel_all(
    symbol: Option<&str>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client.cancel_all_orders(symbol).await?;
    output(&result, ctx.format);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn list_orders(
    symbol: Option<&str>,
    status: Option<&str>,
    side: Option<&str>,
    order_type: Option<&str>,
    sort_by: Option<&str>,
    page: Option<i64>,
    size: Option<i64>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let upper = |v: Option<&str>| v.map(|s| s.to_uppercase());
    let status = upper(status);
    let side = upper(side);
    let order_type = upper(order_type);
    let result = client
        .get_orders(
            symbol,
            status.as_deref(),
            side.as_deref(),
            order_type.as_deref(),
            sort_by,
            page,
            size,
        )
        .await?;
    output(&result, ctx.format);
    Ok(())
}

fn normalize_batch_order(order: &Value, index: usize) -> Result<Value, AppError> {
    let idx = format!("[{index}]");

    if !order.is_object() {
        return Err(super::fail(format!("Order {idx} must be an object.")));
    }

    let symbol = nullish(order, &["symbol", "s"]);
    let Some(symbol) = symbol.and_then(|s| s.as_str()).filter(|s| !s.is_empty()) else {
        return Err(super::fail(format!("Order {idx}: \"symbol\" is required.")));
    };

    let raw_type = nullish(order, &["type", "order_type", "t"]).and_then(|t| t.as_str());
    let Some(raw_type) = raw_type else {
        return Err(super::fail(format!("Order {idx}: \"type\" is required.")));
    };
    let upper_type = raw_type.to_uppercase();
    if !VALID_ORDER_TYPES.contains(&upper_type.as_str()) {
        return Err(super::fail(format!(
            "Order {idx}: invalid type \"{raw_type}\". Use one of: {}.",
            VALID_ORDER_TYPES.join(", ")
        )));
    }

    let side = nullish(order, &["side", "s"]).and_then(|s| s.as_str());
    let Some(side) = side else {
        return Err(super::fail(format!(
            "Order {idx}: \"side\" is required (BUY or SELL)."
        )));
    };
    let upper_side = side.to_uppercase();
    if upper_side != "BUY" && upper_side != "SELL" {
        return Err(super::fail(format!(
            "Order {idx}: invalid side \"{side}\". Use BUY or SELL."
        )));
    }

    let Some(raw_qty) = nullish(order, &["quantity", "order_quantity", "qty", "q"]) else {
        return Err(super::fail(format!(
            "Order {idx}: \"quantity\" is required."
        )));
    };
    let qty_str = js_string_of(raw_qty);
    let qty_num = super::js_number(&qty_str);
    if qty_num.is_nan() || qty_num <= 0.0 {
        return Err(super::fail(format!(
            "Order {idx}: \"quantity\" must be a positive number."
        )));
    }

    let raw_price = nullish(order, &["price", "order_price", "p"]);
    if PRICE_REQUIRED_TYPES.contains(&upper_type.as_str()) {
        let Some(raw_price) = raw_price else {
            return Err(super::fail(format!(
                "Order {idx}: \"price\" is required for {upper_type} orders."
            )));
        };
        let price_num = to_number(raw_price);
        if price_num.is_nan() || price_num <= 0.0 {
            return Err(super::fail(format!(
                "Order {idx}: \"price\" must be a positive number."
            )));
        }
    }

    let raw_client_id = nullish(order, &["client_order_id", "clientOrderId"]);

    let symbol_normalized = normalize_symbol(symbol).map_err(AppError::from)?;
    let mut pairs: Vec<(&str, Value)> = vec![
        ("symbol", Value::String(symbol_normalized)),
        ("order_type", Value::String(upper_type)),
        ("side", Value::String(upper_side)),
        ("order_quantity", Value::String(qty_str)),
    ];
    if let Some(p) = raw_price {
        pairs.push(("order_price", Value::String(js_string_of(p))));
    }
    if let Some(id) = raw_client_id {
        pairs.push(("client_order_id", Value::String(js_string_of(id))));
    }
    Ok(obj(pairs))
}

pub async fn batch_place(
    orders_input: &str,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let raw = if std::path::Path::new(orders_input).exists() {
        std::fs::read_to_string(orders_input).map_err(|_| {
            super::fail("Invalid JSON. Provide a valid JSON array or a path to a JSON file.")
        })?
    } else {
        orders_input.to_string()
    };

    let parsed: Value = serde_json::from_str(&raw).map_err(|_| {
        super::fail("Invalid JSON. Provide a valid JSON array or a path to a JSON file.")
    })?;

    let Value::Array(raw_orders) = parsed else {
        return Err(super::fail("Orders must be a non-empty array."));
    };

    if raw_orders.is_empty() {
        return Err(super::fail("Orders must be a non-empty array."));
    }
    if raw_orders.len() > 10 {
        return Err(super::fail("Maximum 10 orders allowed per batch."));
    }

    let mut normalized = Vec::with_capacity(raw_orders.len());
    for (i, order) in raw_orders.iter().enumerate() {
        normalized.push(normalize_batch_order(order, i)?);
    }

    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client.place_batch_order(&normalized).await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn batch_cancel(
    order_ids: &[String],
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    if order_ids.is_empty() {
        return Err(super::fail("At least one order ID is required."));
    }
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client.cancel_batch_orders(order_ids).await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn batch_cancel_by_client_id(
    client_order_ids: &[String],
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    if client_order_ids.is_empty() {
        return Err(super::fail("At least one client order ID is required."));
    }
    if client_order_ids.len() > 10 {
        return Err(super::fail(
            "Maximum 10 client order IDs allowed per batch.",
        ));
    }
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client
        .cancel_batch_orders_by_client_ids(client_order_ids)
        .await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn cancel_by_client_id(
    client_order_id: &str,
    symbol: &str,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client
        .cancel_order_by_client_id(client_order_id, symbol)
        .await?;
    output(&result, ctx.format);
    Ok(())
}

fn is_numeric_id(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|c| c.is_ascii_digit())
}

pub async fn get_order(
    order_id: Option<&str>,
    client_order_id: Option<&str>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let order_id = order_id.filter(|s| !s.is_empty());
    let client_order_id = client_order_id.filter(|s| !s.is_empty());

    if order_id.is_none() && client_order_id.is_none() {
        return Err(super::fail(
            "Provide either an order ID (positional) or --client-order-id.",
        ));
    }

    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;

    let order_is_numeric = order_id.map(is_numeric_id).unwrap_or(false);
    let resolved_client_order_id =
        client_order_id.or(if order_is_numeric { None } else { order_id });
    let resolved_order_id = if order_is_numeric { order_id } else { None };

    if let Some(id) = resolved_client_order_id {
        let result = client.get_order_by_client_id(id).await?;
        output(&result, ctx.format);
    } else if let Some(id) = resolved_order_id {
        let result = client.get_order_by_order_id(id).await?;
        output(&result, ctx.format);
    } else {
        return Err(super::fail(
            "Could not resolve order identifier. Provide a numeric order ID or use --client-order-id.",
        ));
    }
    Ok(())
}

pub async fn order_trades(order_id: &str, account: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client.get_order_trades(order_id).await?;
    output(&result, ctx.format);
    Ok(())
}
