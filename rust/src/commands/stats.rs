//! `src/commands/stats.ts`

use crate::account_select::create_authenticated_client;
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::output;

#[allow(clippy::too_many_arguments)]
pub async fn distribution_history(
    status: Option<&str>,
    type_: Option<&str>,
    start_t: Option<i64>,
    end_t: Option<i64>,
    page: Option<i64>,
    size: Option<i64>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let data = client
        .get_distribution_history(status, type_, start_t, end_t, page, size)
        .await?;
    output(&data, ctx.format);
    Ok(())
}

pub async fn volume_stats(account: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let data = client.get_volume_stats().await?;
    output(&data, ctx.format);
    Ok(())
}
