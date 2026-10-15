//! `src/commands/trades.ts`

use crate::account_select::create_authenticated_client;
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::output;

pub async fn list_trades(
    symbol: Option<&str>,
    start_t: Option<i64>,
    end_t: Option<i64>,
    page: Option<i64>,
    size: Option<i64>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let upper = symbol.map(|s| s.to_uppercase());
    let result = client
        .get_trades(upper.as_deref(), start_t, end_t, page, size)
        .await?;
    output(&result, ctx.format);
    Ok(())
}
