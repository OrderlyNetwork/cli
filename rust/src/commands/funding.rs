//! `src/commands/funding.ts`

use crate::account_select::create_authenticated_client;
use crate::api::Params;
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::output;

pub async fn funding_history(
    symbol: Option<&str>,
    start_t: Option<i64>,
    end_t: Option<i64>,
    page: Option<i64>,
    size: Option<i64>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;

    let mut params = Params::new();
    if let Some(s) = symbol {
        if !s.is_empty() {
            params.add("symbol", s.to_uppercase());
        }
    }
    // The TS client uses truthy checks, so a timestamp of 0 is dropped.
    if let Some(v) = start_t {
        if v != 0 {
            params.add("start_t", v);
        }
    }
    if let Some(v) = end_t {
        if v != 0 {
            params.add("end_t", v);
        }
    }
    params.add("page", page.unwrap_or(1));
    params.add("size", size.unwrap_or(25));

    let result = client
        .get(&format!("/v1/funding_fee/history?{params}"))
        .await?;
    output(&result, ctx.format);
    Ok(())
}
