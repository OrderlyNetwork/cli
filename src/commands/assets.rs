//! `src/commands/assets.ts`

use crate::account_select::create_authenticated_client;
use crate::api::{js_number, obj, Params};
use crate::cli::Ctx;
use crate::contracts;
use crate::error::AppError;
use crate::keychain::get_wallet_key;
use crate::output::output;
use crate::types::Network;
use crate::{evm, solana};
use serde_json::Value;

pub async fn get_chains(
    network: Network,
    ctx: Ctx,
    broker_id: Option<&str>,
    verbose: bool,
) -> Result<(), AppError> {
    let client = crate::api::OrderlyClient::new(network);
    let mut result = client.get_public("/v1/public/chain_info").await?;

    if let Some(rows) = result
        .get_mut("data")
        .and_then(|d| d.get_mut("rows"))
        .and_then(|r| r.as_array_mut())
    {
        if let Some(broker_id) = broker_id {
            rows.retain(|chain| {
                chain
                    .get("broker_ids")
                    .and_then(|b| b.as_array())
                    .map(|arr| arr.iter().any(|v| v.as_str() == Some(broker_id)))
                    .unwrap_or(false)
            });
        }
        if !verbose {
            for row in rows.iter_mut() {
                if let Some(map) = row.as_object_mut() {
                    map.remove("broker_ids");
                }
            }
        }
    }

    output(&result, ctx.format);
    Ok(())
}

pub async fn get_tokens(network: Network, ctx: Ctx, verbose: bool) -> Result<(), AppError> {
    let client = crate::api::OrderlyClient::new(network);
    let mut result = client.get_public("/v1/public/token").await?;

    if !verbose {
        if let Some(rows) = result
            .get_mut("data")
            .and_then(|d| d.get_mut("rows"))
            .and_then(|r| r.as_array_mut())
        {
            for row in rows.iter_mut() {
                if let Some(map) = row.as_object_mut() {
                    map.remove("chain_details");
                }
            }
        }
    }

    output(&result, ctx.format);
    Ok(())
}

pub async fn deposit_info(token: &str, chain_id: i64, ctx: Ctx) -> Result<(), AppError> {
    if !contracts::is_supported_chain(chain_id, ctx.network).await? {
        return Err(super::fail(format!(
            "Chain ID {chain_id} is not supported on {}. Use 'orderly chains' to see supported chains.",
            ctx.network
        )));
    }

    let Some(chain_vault) = contracts::get_chain_info(chain_id, ctx.network).await? else {
        return Err(super::fail(format!(
            "Chain ID {chain_id} not found in chain info."
        )));
    };

    let Some(token_address) = contracts::get_token_address(token, chain_id, ctx.network).await?
    else {
        return Err(super::fail_hints(
            format!(
                "Token {} is not available on chain {chain_id}.",
                token.to_uppercase()
            ),
            vec![
                "Use 'orderly tokens' to see supported tokens and 'orderly chains' to see supported chains."
                    .to_string(),
            ],
        ));
    };

    let vault_address = chain_vault.get("vault_address").cloned();
    let mut result = match chain_vault {
        Value::Object(m) => m,
        other => {
            let mut m = serde_json::Map::new();
            m.insert("chain_info".to_string(), other);
            m
        }
    };
    result.remove("vault_address");
    result.insert("chainId".to_string(), js_number(chain_id as f64));
    result.insert("token".to_string(), Value::String(token.to_uppercase()));
    result.insert("tokenAddress".to_string(), Value::String(token_address));
    result.insert(
        "vaultAddress".to_string(),
        vault_address
            .filter(|v| !v.is_null())
            .unwrap_or(Value::Null),
    );

    output(&Value::Object(result), ctx.format);
    Ok(())
}

async fn resolve_raw_amount(
    client: &crate::api::OrderlyClient,
    token: &str,
    chain_id: i64,
    amount: &str,
) -> Result<String, AppError> {
    let invalid = || {
        super::fail_hints(
            format!("Invalid amount: {amount}"),
            vec!["Amount must be a valid number (e.g., 10.5)".to_string()],
        )
    };

    let response = client
        .get("/v1/public/token")
        .await
        .map_err(|_| invalid())?;

    let rows = response
        .get("data")
        .and_then(|d| d.get("rows"))
        .and_then(|r| r.as_array());
    if response.get("success").and_then(|s| s.as_bool()) != Some(true) || rows.is_none() {
        return Err(super::fail("Failed to fetch token info"));
    }

    let upper = token.to_uppercase();
    let Some(token_info) = rows
        .unwrap()
        .iter()
        .find(|t| t.get("token").and_then(|v| v.as_str()) == Some(upper.as_str()))
    else {
        return Err(super::fail(format!("Token {upper} not found")));
    };

    let chain_id_str = chain_id.to_string();
    let decimals = token_info
        .get("chain_details")
        .and_then(|c| c.as_array())
        .and_then(|arr| {
            arr.iter().find(|c| {
                c.get("chain_id")
                    .map(|v| crate::commands::settle::stringify_number(v) == chain_id_str)
                    .unwrap_or(false)
            })
        })
        .and_then(|c| c.get("decimals"))
        .and_then(|d| d.as_i64())
        .or_else(|| token_info.get("decimals").and_then(|d| d.as_i64()))
        .ok_or_else(|| super::fail(format!("Token {upper} not found")))?;

    evm::parse_units(amount, decimals.max(0) as u32).map_err(|_| invalid())
}

#[allow(clippy::too_many_arguments)]
pub async fn withdraw(
    token: &str,
    amount: &str,
    receiver: Option<&str>,
    chain_id: i64,
    account: Option<&str>,
    ctx: Ctx,
    raw_amount: bool,
    allow_cross_chain: bool,
    dry_run: bool,
) -> Result<(), AppError> {
    if dry_run {
        let amount_num = super::js_number(amount);
        if amount.is_empty() || amount_num.is_nan() || (!raw_amount && amount_num <= 0.0) {
            let hint = if raw_amount {
                "Amount must be a valid positive number."
            } else {
                "Amount must be a valid positive number (e.g., 10.5)"
            };
            return Err(super::fail_hints(
                format!("Invalid amount: {amount}"),
                vec![hint.to_string()],
            ));
        }

        let mut body_pairs = vec![
            ("message", Value::Null),
            ("signature", Value::Null),
            ("userAddress", Value::Null),
            (
                "verifyingContract",
                Value::String(contracts::get_verifying_contract(ctx.network).to_string()),
            ),
        ];
        if allow_cross_chain {
            body_pairs.push(("allow_cross_chain_withdrawal", Value::Bool(true)));
        }
        let receiver = receiver.filter(|r| !r.is_empty());
        let note = format!(
            "Withdrawal message/signature/userAddress require the account wallet. token={} chain_id={} amount={} raw={} receiver={}.",
            token.to_uppercase(),
            chain_id,
            amount,
            raw_amount,
            receiver.unwrap_or("<wallet address>"),
        );
        return super::dry_run::emit(
            &crate::api::RequestSpec::new("POST", "/v1/withdraw_request", Some(obj(body_pairs))),
            Some(&note),
            &[
                "account resolution (--account avoids the prompt)",
                "GET /v1/public/token (decimals, unless --raw)",
                "GET /v1/withdraw_nonce",
                "wallet signature (EIP-712 or Ed25519)",
            ],
        );
    }

    let (_, key_pair, client) = create_authenticated_client(account, ctx.network).await?;

    let broker_id = client.get_broker_id(&key_pair.account_id).await?;

    if !contracts::is_supported_chain(chain_id, ctx.network).await? {
        return Err(super::fail(format!(
            "Chain ID {chain_id} is not supported on {}. Use 'orderly chains' to see supported chains.",
            ctx.network
        )));
    }

    let amount_num = super::js_number(amount);
    let raw_amount_value = if raw_amount {
        if amount.is_empty() || amount_num.is_nan() {
            return Err(super::fail_hints(
                format!("Invalid amount: {amount}"),
                vec!["Amount must be a valid positive number.".to_string()],
            ));
        }
        amount.to_string()
    } else {
        if amount.is_empty() || amount_num.is_nan() || amount_num <= 0.0 {
            return Err(super::fail_hints(
                format!("Invalid amount: {amount}"),
                vec!["Amount must be a valid positive number (e.g., 10.5)".to_string()],
            ));
        }
        resolve_raw_amount(&client, token, chain_id, amount).await?
    };

    if let Some((fee, cross_fee)) =
        contracts::get_withdrawal_fee(token, chain_id, ctx.network).await?
    {
        let fee = if allow_cross_chain { cross_fee } else { fee };
        if fee > 0.0 && amount_num <= fee {
            return Err(super::fail_hints(
                format!(
                    "Withdrawal amount ({amount} {}) must be greater than the withdrawal fee ({fee} {}).",
                    token.to_uppercase(),
                    token.to_uppercase()
                ),
                vec![format!(
                    "Minimum withdrawal: slightly above {fee} {} (amount must exceed the fee).",
                    token.to_uppercase()
                )],
            ));
        }
    }

    let mut settled_pnl_id: Option<Value> = None;
    if super::settle::has_negative_unsettled_pnl(&client).await {
        if let Ok(settle_result) =
            super::settle::perform_settle_pnl(&client, &key_pair, ctx.network).await
        {
            if let Some(id) = settle_result.get("settle_pnl_id") {
                settled_pnl_id = Some(id.clone());
            }
        }
    }

    let nonce_response = client.get("/v1/withdraw_nonce").await?;
    let withdraw_nonce_value = nonce_response
        .get("data")
        .and_then(|d| d.get("withdraw_nonce"))
        .filter(|v| !v.is_null());
    if nonce_response.get("success").and_then(|s| s.as_bool()) != Some(true)
        || withdraw_nonce_value.is_none()
    {
        return Err(super::fail("Failed to get withdrawal nonce"));
    }
    let withdraw_nonce = super::settle::stringify_number(withdraw_nonce_value.unwrap());

    let timestamp = super::now_ms();

    let address = key_pair.address.clone().unwrap_or_default();
    let wallet_key = get_wallet_key(&address, ctx.network.as_str())
        .await
        .map_err(AppError::Msg)?
        .ok_or_else(|| {
            super::fail(format!(
                "No wallet key found for address {address}. Wallet keys are required for withdrawal signing. Use orderly wallet-import to import your wallet key."
            ))
        })?;

    let resolved_receiver = receiver
        .filter(|r| !r.is_empty())
        .map(String::from)
        .unwrap_or_else(|| wallet_key.address.clone());
    let wallet_type = if wallet_key.wallet_type.is_empty() {
        key_pair
            .wallet_type
            .clone()
            .unwrap_or_else(|| "EVM".to_string())
    } else {
        wallet_key.wallet_type.clone()
    };

    if wallet_type == "SOL" && evm::is_valid_evm_address(&resolved_receiver) {
        return Err(super::fail_hints(
            format!("Cannot withdraw to an EVM address ({resolved_receiver}) using a SOL wallet."),
            vec![
                "SOL wallets can only withdraw to SOL (base58) addresses.".to_string(),
                "To withdraw to an EVM chain, use an EVM wallet account instead.".to_string(),
            ],
        ));
    }

    if wallet_type == "EVM"
        && !evm::is_valid_evm_address(&resolved_receiver)
        && solana::is_valid_solana_address(&resolved_receiver)
    {
        return Err(super::fail_hints(
            format!("Cannot withdraw to a SOL address ({resolved_receiver}) using an EVM wallet."),
            vec![
                "EVM wallets can only withdraw to EVM (0x...) addresses.".to_string(),
                "To withdraw to a SOL chain, use a SOL wallet account instead.".to_string(),
            ],
        ));
    }

    let token_upper = token.to_uppercase();
    let (message, signature) = if wallet_type == "SOL" {
        let wallet =
            solana::create_solana_wallet_from_private_key(&wallet_key.private_key, ctx.network)
                .map_err(AppError::Msg)?;
        let params = solana::WithdrawParams {
            broker_id: broker_id.clone(),
            chain_id: chain_id.max(0) as u64,
            receiver: resolved_receiver.clone(),
            token: token_upper.clone(),
            amount: raw_amount_value.clone(),
            withdraw_nonce: withdraw_nonce.clone(),
            timestamp,
        };
        solana::sign_withdraw(&wallet, &params)
    } else {
        let wallet =
            evm::EvmWallet::from_private_key(&evm::normalize_private_key(&wallet_key.private_key))
                .map_err(AppError::Msg)?;
        let mut map = serde_json::Map::new();
        map.insert("brokerId".to_string(), Value::String(broker_id.clone()));
        map.insert("chainId".to_string(), js_number(chain_id as f64));
        map.insert(
            "receiver".to_string(),
            Value::String(resolved_receiver.clone()),
        );
        map.insert("token".to_string(), Value::String(token_upper.clone()));
        map.insert(
            "amount".to_string(),
            Value::String(raw_amount_value.clone()),
        );
        map.insert(
            "withdrawNonce".to_string(),
            Value::String(withdraw_nonce.clone()),
        );
        map.insert(
            "timestamp".to_string(),
            Value::String(timestamp.to_string()),
        );
        let signature = evm::sign_withdraw(&wallet, &map, ctx.network);
        (Value::Object(map), signature)
    };

    let mut body_pairs = vec![
        ("message", message),
        ("signature", Value::String(signature)),
        (
            "userAddress",
            Value::String(key_pair.address.clone().unwrap_or_default()),
        ),
        (
            "verifyingContract",
            Value::String(contracts::get_verifying_contract(ctx.network).to_string()),
        ),
    ];
    if allow_cross_chain {
        body_pairs.push(("allow_cross_chain_withdrawal", Value::Bool(true)));
    }

    let result = client
        .post("/v1/withdraw_request", Some(&obj(body_pairs)))
        .await?;

    let success = result.get("success").and_then(|s| s.as_bool()) == Some(true);
    let withdraw_id = result.get("data").and_then(|d| d.get("withdraw_id"));
    if success && withdraw_id.map(|v| !super::settle::is_falsy(v)) == Some(true) {
        let mut out = result
            .get("data")
            .and_then(|d| d.as_object())
            .cloned()
            .unwrap_or_default();
        if let Some(id) = settled_pnl_id {
            out.insert("auto_settled".to_string(), Value::Bool(true));
            out.insert("settle_pnl_id".to_string(), id);
        }
        output(&Value::Object(out), ctx.format);
    } else {
        let api_msg = result
            .get("message")
            .and_then(|m| m.as_str())
            .map(String::from);
        let mut hints: Vec<String> = Vec::new();
        if allow_cross_chain {
            hints.push("Check that the token and chain combination is valid.".to_string());
        } else {
            hints.push(
                "If the error mentions cross-chain, use --allow-cross-chain flag.".to_string(),
            );
        }
        if let Some(msg) = &api_msg {
            if msg.to_lowercase().contains("amount") {
                hints.push(
                    "The amount may be below the minimum withdrawal or exceed your available balance."
                        .to_string(),
                );
            }
        }
        let suffix = api_msg.map(|m| format!(": {m}")).unwrap_or_default();
        return Err(super::fail_hints(
            format!("Failed to initiate withdrawal{suffix}"),
            hints,
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn asset_history(
    token: Option<&str>,
    side: Option<&str>,
    status: Option<&str>,
    page: Option<i64>,
    size: Option<i64>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    let (_, _, client) = create_authenticated_client(account, ctx.network).await?;

    let mut params = Params::new();
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        params.add("token", t.to_uppercase());
    }
    if let Some(s) = side.filter(|s| !s.is_empty()) {
        params.add("side", s.to_uppercase());
    }
    if let Some(s) = status.filter(|s| !s.is_empty()) {
        params.add("status", s.to_uppercase());
    }
    params.add("page", page.unwrap_or(1));
    params.add("size", size.unwrap_or(25));

    let result = client.get(&format!("/v1/asset/history?{params}")).await?;
    output(&result, ctx.format);
    Ok(())
}
