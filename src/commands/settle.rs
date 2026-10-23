//! `src/commands/settle.ts`

use crate::account_select::create_authenticated_client;
use crate::api::{obj, OrderlyClient};
use crate::cli::Ctx;
use crate::error::AppError;
use crate::keychain::{self, KeyPair};
use crate::output::output;
use crate::types::Network;
use crate::{evm, solana};
use serde_json::Value;

const VERIFYING_CONTRACTS_MAINNET: &str = "0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203";
const VERIFYING_CONTRACTS_TESTNET: &str = "0x1826B75e2ef249173FC735149AE4B8e9ea10abff";

fn verifying_contract(network: Network) -> &'static str {
    match network {
        Network::Mainnet => VERIFYING_CONTRACTS_MAINNET,
        Network::Testnet => VERIFYING_CONTRACTS_TESTNET,
    }
}

fn chain_id_for(wallet_type: &str, network: Network) -> u64 {
    if wallet_type == "SOL" {
        solana::get_solana_chain_id(network)
    } else if network == Network::Mainnet {
        42161
    } else {
        421614
    }
}

/// `String(value)` for a JSON scalar (numbers keep their JS representation).
pub fn stringify_number(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(u) = n.as_u64() {
                u.to_string()
            } else {
                crate::output::js_f64_to_string(n.as_f64().unwrap_or(f64::NAN))
            }
        }
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

/// JS falsiness for scalar JSON values.
pub fn is_falsy(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Bool(b) => !*b,
        Value::Number(n) => n.as_f64().map(|f| f == 0.0).unwrap_or(false),
        Value::String(s) => s.is_empty(),
        _ => false,
    }
}

/// Sign and submit a PnL settlement. Mirrors `performSettlePnl`.
pub async fn perform_settle_pnl(
    client: &OrderlyClient,
    key_pair: &KeyPair,
    network: Network,
) -> Result<Value, AppError> {
    let broker_id = client.get_broker_id(&key_pair.account_id).await?;

    let nonce_response = client.get_settle_nonce().await?;
    let settle_nonce_value = nonce_response
        .get("data")
        .and_then(|d| d.get("settle_nonce"))
        .filter(|v| !v.is_null());
    if nonce_response.get("success").and_then(|s| s.as_bool()) != Some(true)
        || settle_nonce_value.is_none()
    {
        return Err(super::fail("Failed to get settle nonce from API"));
    }
    let settle_nonce = stringify_number(settle_nonce_value.unwrap());

    let address = key_pair.address.clone().unwrap_or_default();
    let wallet_key = keychain::get_wallet_key(&address, network.as_str())
        .await
        .map_err(AppError::Msg)?
        .ok_or_else(|| super::fail(format!("No wallet key found for {address}")))?;

    let wallet_type = if wallet_key.wallet_type.is_empty() {
        key_pair
            .wallet_type
            .clone()
            .unwrap_or_else(|| "EVM".to_string())
    } else {
        wallet_key.wallet_type.clone()
    };
    let chain_id = chain_id_for(&wallet_type, network);
    let timestamp = super::now_ms();

    let (message, signature) = if wallet_type == "SOL" {
        let wallet =
            solana::create_solana_wallet_from_private_key(&wallet_key.private_key, network)
                .map_err(AppError::Msg)?;
        solana::sign_settle_pnl(&wallet, &broker_id, chain_id, &settle_nonce, timestamp)
    } else {
        let wallet =
            evm::EvmWallet::from_private_key(&evm::normalize_private_key(&wallet_key.private_key))
                .map_err(AppError::Msg)?;
        let message = obj(vec![
            ("brokerId", Value::String(broker_id.clone())),
            ("chainId", Value::from(chain_id)),
            ("settleNonce", Value::String(settle_nonce.clone())),
            ("timestamp", Value::from(timestamp)),
        ]);
        let signature = evm::sign_settle_pnl(&wallet, &message, network);
        (message, signature)
    };

    let body = obj(vec![
        ("message", message),
        ("signature", Value::String(signature)),
        (
            "userAddress",
            Value::String(key_pair.address.clone().unwrap_or_default()),
        ),
        (
            "verifyingContract",
            Value::String(verifying_contract(network).to_string()),
        ),
    ]);

    let result = client.post("/v1/settle_pnl", Some(&body)).await?;

    if result.get("success").and_then(|s| s.as_bool()) == Some(true) {
        if let Some(id) = result
            .get("data")
            .and_then(|d| d.get("settle_pnl_id"))
            .filter(|v| !is_falsy(v))
        {
            let _ = id;
            return Ok(result.get("data").cloned().unwrap_or(Value::Null));
        }
    }

    let msg = result
        .get("message")
        .and_then(|m| m.as_str())
        .map(String::from)
        .or_else(|| {
            result
                .get("code")
                .and_then(|c| c.as_i64())
                .map(|c| c.to_string())
        })
        .unwrap_or_else(|| "Unknown error".to_string());
    Err(super::fail(format!("Settle PnL failed: {msg}")))
}

/// Mirrors `hasNegativeUnsettledPnl`.
pub async fn has_negative_unsettled_pnl(client: &OrderlyClient) -> bool {
    let Ok(positions) = client.get("/v1/positions").await else {
        return false;
    };
    let Some(rows) = positions
        .get("data")
        .and_then(|d| d.get("rows"))
        .and_then(|r| r.as_array())
    else {
        return false;
    };
    rows.iter().any(|row| {
        row.get("unsettled_pnl")
            .and_then(|v| v.as_f64())
            .map(|v| v < 0.0)
            .unwrap_or(false)
    })
}

pub async fn settle_pnl(dry_run: bool, account: Option<&str>, ctx: Ctx) -> Result<(), AppError> {
    if dry_run {
        let body = obj(vec![
            ("message", Value::Null),
            ("signature", Value::Null),
            ("userAddress", Value::Null),
            (
                "verifyingContract",
                Value::String(verifying_contract(ctx.network).to_string()),
            ),
        ]);
        return super::dry_run::emit(
            &crate::api::RequestSpec::new("POST", "/v1/settle_pnl", Some(body)),
            Some(
                "message/signature/userAddress require the account's broker_id, the settle nonce and a wallet signature; none are produced in dry-run mode.",
            ),
            &[
                "account resolution (--account avoids the prompt)",
                "GET /v1/public/account?account_id={account} (broker_id)",
                "GET /v1/settle_nonce",
                "wallet signature (EIP-712 or Ed25519)",
            ],
        );
    }

    let (_, key_pair, client) = create_authenticated_client(account, ctx.network).await?;
    let result = perform_settle_pnl(&client, &key_pair, ctx.network).await?;
    output(&result, ctx.format);
    Ok(())
}

pub async fn settle_pnl_history(
    page: Option<i64>,
    size: Option<i64>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;
    let result = client.get_pnl_settlement_history(page, size).await?;
    output(&result, ctx.format);
    Ok(())
}
