//! `src/commands/faucet.ts`

use crate::api::OrderlyClient;
use crate::cli::Ctx;
use crate::error::AppError;
use crate::output::output;
use crate::types::Network;

pub async fn faucet_usdc(
    address: &str,
    chain_id: Option<&str>,
    ctx: Ctx,
    broker_id: Option<&str>,
) -> Result<(), AppError> {
    if ctx.network != Network::Testnet {
        return Err(super::fail(
            "Faucet is only available on testnet. Use --network testnet",
        ));
    }

    let Some(chain_id) = chain_id else {
        return Err(super::fail(
            "--chain-id is required. Example: --chain-id 421614 (Arbitrum Sepolia), --chain-id 901901901 (SOL Devnet)",
        ));
    };

    let client = OrderlyClient::new(ctx.network);
    let result = client
        .faucet_usdc(address, broker_id.unwrap_or("demo"), Some(chain_id))
        .await?;

    if result.get("success").and_then(|s| s.as_bool()) == Some(false) {
        let message = result
            .get("message")
            .and_then(|m| m.as_str())
            .map(String::from)
            .unwrap_or_else(|| {
                let code = result
                    .get("code")
                    .map(crate::commands::settle::stringify_number)
                    .unwrap_or_default();
                format!("Faucet request failed (code: {code})")
            });
        return Err(super::fail(message));
    }

    output(&result, ctx.format);
    Ok(())
}
