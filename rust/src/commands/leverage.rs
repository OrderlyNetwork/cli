//! `src/commands/leverage.ts`

use crate::account_select::create_authenticated_client;
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::output;

pub async fn get_or_set_leverage(
    symbol: &str,
    leverage: Option<f64>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = match leverage {
        Some(value) => client.set_leverage(&symbol.to_uppercase(), value).await?,
        None => client.get_leverage(&symbol.to_uppercase()).await?,
    };
    output(&result, ctx.format);
    Ok(())
}
