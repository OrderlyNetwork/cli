//! `src/commands/referral.ts`

use crate::account_select::create_authenticated_client;
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::output;

pub async fn info(account: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let data = client.get_referral_info().await?;
    output(&data, ctx.format);
    Ok(())
}
