//! `src/commands/notification.ts`

use crate::account_select::create_authenticated_client;
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::output;

pub async fn inbox(
    type_: Option<&str>,
    page: Option<i64>,
    size: Option<i64>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let data = client.get_notification_inbox(type_, page, size).await?;
    output(&data, ctx.format);
    Ok(())
}

pub async fn inbox_unread(account: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let data = client.get_notification_inbox_unread().await?;
    output(&data, ctx.format);
    Ok(())
}
