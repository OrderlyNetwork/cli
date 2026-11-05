//! `src/commands/faucet.ts`

use crate::account_select::create_authenticated_client;
use crate::api::{js_number, obj, OrderlyClient};
use crate::cli::Ctx;
use crate::colors;
use crate::error::AppError;
use crate::output::output;
use crate::types::Network;
use serde_json::Value;
use std::time::Duration;

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

    if let Some(message) = faucet_failure(&result) {
        return Err(super::fail(message));
    }

    output(&result, ctx.format);
    Ok(())
}

/// Request testnet USDC for a stored account and optionally wait for it to
/// appear in the Orderly account balance.
///
/// The operator faucet is the live endpoint used by the Orderly SDK. It credits
/// the trading account through a deposit, so the wallet never needs a separate
/// deposit step.
pub async fn faucet_account(
    account: Option<&str>,
    chain_id: Option<&str>,
    broker_id: Option<&str>,
    wait: bool,
    timeout: u64,
    ctx: Ctx,
) -> Result<(), AppError> {
    if ctx.network != Network::Testnet {
        return Err(super::fail(
            "Faucet is only available on testnet. Use --network testnet",
        ));
    }
    if wait && timeout == 0 {
        return Err(super::fail("--timeout must be a positive integer."));
    }

    let (account_id, key_pair, client) = create_authenticated_client(account, ctx.network).await?;
    let address =
        key_pair
            .address
            .filter(|address| !address.is_empty())
            .ok_or_else(|| {
                super::fail_hints(
                "No wallet address is stored for this account.",
                vec!["Use `orderly faucet-usdc <address> --broker-id <id> --chain-id <id>` instead."
                    .to_string()],
            )
            })?;

    let broker_id = match broker_id.filter(|value| !value.is_empty()) {
        Some(broker_id) => broker_id.to_string(),
        None => client.get_broker_id(&account_id).await.map_err(|_| {
            super::fail_hints(
                format!("Could not resolve broker_id for account {account_id}."),
                vec!["Pass --broker-id <id>.".to_string()],
            )
        })?,
    };

    let is_solana = !address.starts_with("0x");
    let effective_chain_id = if is_solana {
        None
    } else {
        Some(chain_id.unwrap_or("421614"))
    };

    let first_balance = client.get_balances().await?;
    let balance_before = usdc_balance(&first_balance);
    let result = client
        .faucet_usdc(&address, &broker_id, effective_chain_id)
        .await?;

    if let Some(message) = faucet_failure(&result) {
        return Err(super::fail(message));
    }

    let mut pairs = vec![
        ("success", Value::Bool(true)),
        ("account_id", Value::String(account_id)),
        ("address", Value::String(address)),
        ("broker_id", Value::String(broker_id)),
        (
            "chain_id",
            effective_chain_id
                .map(|value| Value::String(value.to_string()))
                .unwrap_or(Value::Null),
        ),
        ("balance_before", js_number(balance_before)),
    ];

    if wait {
        let deadline = std::time::Instant::now() + Duration::from_secs(timeout);
        let mut balance_after = balance_before;
        let mut timed_out = true;
        while std::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let current = client.get_balances().await?;
            balance_after = usdc_balance(&current);
            if balance_after > balance_before + 1e-9 {
                timed_out = false;
                break;
            }
        }
        pairs.push(("balance_after", js_number(balance_after)));
        pairs.push(("credited", js_number(balance_after - balance_before)));
        pairs.push(("wait_timed_out", Value::Bool(timed_out)));
        if timed_out {
            eprintln!(
                "{}",
                colors::dim(
                    "Faucet accepted; USDC has not arrived yet. Check `orderly account-balance`."
                )
            );
        }
    }

    pairs.push(("faucet", result));
    output(&obj(pairs), ctx.format);
    Ok(())
}

fn faucet_failure(result: &Value) -> Option<String> {
    if result.get("success").and_then(|s| s.as_bool()) != Some(false) {
        return None;
    }
    Some(
        result
            .get("message")
            .and_then(|m| m.as_str())
            .map(String::from)
            .unwrap_or_else(|| {
                let code = result
                    .get("code")
                    .map(crate::commands::settle::stringify_number)
                    .unwrap_or_default();
                format!("Faucet request failed (code: {code})")
            }),
    )
}

fn usdc_balance(raw: &Value) -> f64 {
    let data = raw.get("data").unwrap_or(raw);
    data.get("holding")
        .and_then(|holding| holding.as_array())
        .map(|rows| {
            rows.iter()
                .filter(|row| row.get("token").and_then(|token| token.as_str()) == Some("USDC"))
                .filter_map(|row| {
                    row.get("holding").and_then(|value| {
                        value
                            .as_f64()
                            .or_else(|| value.as_str().and_then(|number| number.parse().ok()))
                    })
                })
                .sum()
        })
        .unwrap_or(0.0)
}
