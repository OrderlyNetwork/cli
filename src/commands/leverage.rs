//! `src/commands/leverage.ts`

use crate::account_select::create_authenticated_client;
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::output;

pub async fn get_or_set_leverage(
    symbol: &str,
    leverage: Option<f64>,
    dry_run: bool,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    if dry_run {
        let symbol = symbol.to_uppercase();
        return match leverage {
            Some(value) => super::dry_run::emit(
                &crate::api::OrderlyClient::set_leverage_spec(&symbol, value),
                None,
                &[],
            ),
            None => super::dry_run::emit(
                &crate::api::RequestSpec::new(
                    "GET",
                    format!("/v1/client/leverage?symbol={symbol}"),
                    None,
                ),
                Some("No --value given: this is the read-only leverage request."),
                &[],
            ),
        };
    }

    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = match leverage {
        Some(value) => client.set_leverage(&symbol.to_uppercase(), value).await?,
        None => client.get_leverage(&symbol.to_uppercase()).await?,
    };
    output(&result, ctx.format);
    Ok(())
}
