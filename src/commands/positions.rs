//! `src/commands/positions.ts`

use crate::account_select::create_authenticated_client;
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::output;

pub async fn list_positions(
    account: Option<&str>,
    product_type: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client.get_positions(product_type).await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn close_position(
    symbol: &str,
    account: Option<&str>,
    ctx: Ctx,
    quantity: Option<f64>,
    dry_run: bool,
) -> Result<(), AppError> {
    let symbol = symbol.to_uppercase();
    if dry_run {
        let quantity_value = match quantity {
            Some(q) => serde_json::Value::String(crate::output::js_f64_to_string(q)),
            None => serde_json::Value::Null,
        };
        let body = crate::api::obj(vec![
            ("symbol", serde_json::Value::String(symbol)),
            (
                "order_type",
                serde_json::Value::String("MARKET".to_string()),
            ),
            ("side", serde_json::Value::Null),
            ("order_quantity", quantity_value),
            ("reduce_only", serde_json::Value::Bool(true)),
        ]);
        return super::dry_run::emit(
            &crate::api::OrderlyClient::place_order_spec(&body),
            Some(
                "side (BUY for a short, SELL for a long) and the default quantity come from the live position. MARKET is not supported for Orderly Predict; use predict-close for Predict positions.",
            ),
            &["GET /v1/position/{symbol} (authenticated)"],
        );
    }

    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    if let Ok(round) = client.get_predict_round(&symbol).await {
        if round.get("success").and_then(|s| s.as_bool()) == Some(true) {
            return Err(super::fail_hints(
                format!("{symbol} is an Orderly Predict round; MARKET close is not supported."),
                vec![format!(
                    "Use `orderly predict-close {symbol}` to close with a protected IOC order."
                )],
            ));
        }
    }
    let result = client.close_position(&symbol, quantity).await?;
    output(&result, ctx.format);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn position_history(
    symbol: Option<&str>,
    start_t: Option<i64>,
    end_t: Option<i64>,
    page: Option<i64>,
    size: Option<i64>,
    product_type: Option<&str>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client
        .get_position_history(symbol, start_t, end_t, page, size, product_type)
        .await?;
    output(&result, ctx.format);
    Ok(())
}
