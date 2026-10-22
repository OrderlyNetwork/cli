//! On-chain contract metadata mirroring `src/lib/contracts.ts`.
//!
//! Fetches `/v1/public/chain_info` and `/v1/public/token` (cached per process)
//! and answers address/decimals/fee lookups.

use crate::api::OrderlyClient;
use crate::error::AppError;
use crate::types::Network;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

pub const VERIFYING_CONTRACTS_MAINNET: &str = "0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203";
pub const VERIFYING_CONTRACTS_TESTNET: &str = "0x1826B75e2ef249173FC735149AE4B8e9ea10abff";

pub fn get_verifying_contract(network: Network) -> &'static str {
    match network {
        Network::Mainnet => VERIFYING_CONTRACTS_MAINNET,
        Network::Testnet => VERIFYING_CONTRACTS_TESTNET,
    }
}

fn cache() -> &'static Mutex<HashMap<&'static str, Vec<Value>>> {
    static CACHE: OnceLock<Mutex<HashMap<&'static str, Vec<Value>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_key(kind: &str, network: Network) -> &'static str {
    match (kind, network) {
        ("chain", Network::Mainnet) => "chain:mainnet",
        ("chain", Network::Testnet) => "chain:testnet",
        ("token", Network::Mainnet) => "token:mainnet",
        _ => "token:testnet",
    }
}

fn rows_of(response: &Value) -> Vec<Value> {
    if let Some(rows) = response.get("data").and_then(|d| d.get("rows")) {
        if let Some(arr) = rows.as_array() {
            return arr.clone();
        }
    }
    if let Some(arr) = response.get("rows").and_then(|r| r.as_array()) {
        return arr.clone();
    }
    Vec::new()
}

async fn fetch_cached(kind: &str, path: &str, network: Network) -> Result<Vec<Value>, AppError> {
    let key = cache_key(kind, network);
    if let Some(rows) = cache().lock().unwrap().get(key) {
        return Ok(rows.clone());
    }
    let client = OrderlyClient::new(network);
    let response = client.get_public(path).await?;
    let rows = rows_of(&response);
    cache().lock().unwrap().insert(key, rows.clone());
    Ok(rows)
}

async fn fetch_chain_info(network: Network) -> Result<Vec<Value>, AppError> {
    fetch_cached("chain", "/v1/public/chain_info", network).await
}

async fn fetch_token_info(network: Network) -> Result<Vec<Value>, AppError> {
    fetch_cached("token", "/v1/public/token", network).await
}

fn number_eq_str(v: Option<&Value>, target: i64) -> bool {
    match v {
        Some(Value::Number(n)) => n.as_i64() == Some(target),
        Some(Value::String(s)) => s.parse::<i64>().ok() == Some(target),
        _ => false,
    }
}

pub async fn get_chain_info(chain_id: i64, network: Network) -> Result<Option<Value>, AppError> {
    let chains = fetch_chain_info(network).await?;
    Ok(chains
        .into_iter()
        .find(|c| number_eq_str(c.get("chain_id"), chain_id)))
}

pub async fn get_chain_name(chain_id: i64, network: Network) -> Result<String, AppError> {
    let chain = get_chain_info(chain_id, network).await?;
    Ok(chain
        .and_then(|c| c.get("name").and_then(|n| n.as_str()).map(String::from))
        .unwrap_or_else(|| format!("Chain {chain_id}")))
}

pub async fn get_chain_vault_address(
    chain_id: i64,
    network: Network,
) -> Result<Option<String>, AppError> {
    let chain = get_chain_info(chain_id, network).await?;
    Ok(chain.and_then(|c| {
        c.get("vault_address")
            .and_then(|v| v.as_str())
            .map(String::from)
    }))
}

fn chain_detail(token_info: &Value, chain_id: i64) -> Option<&Value> {
    token_info
        .get("chain_details")
        .and_then(|c| c.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|c| number_eq_str(c.get("chain_id"), chain_id))
        })
}

pub async fn get_token_address(
    token: &str,
    chain_id: i64,
    network: Network,
) -> Result<Option<String>, AppError> {
    let tokens = fetch_token_info(network).await?;
    let token_info = tokens
        .iter()
        .find(|t| t.get("token").and_then(|v| v.as_str()) == Some(&token.to_uppercase()));
    Ok(token_info
        .and_then(|t| chain_detail(t, chain_id))
        .and_then(|c| c.get("contract_address"))
        .and_then(|v| v.as_str())
        .map(String::from))
}

pub async fn get_token_decimals(
    token: &str,
    chain_id: i64,
    network: Network,
) -> Result<Option<i64>, AppError> {
    let tokens = fetch_token_info(network).await?;
    let token_info = tokens
        .iter()
        .find(|t| t.get("token").and_then(|v| v.as_str()) == Some(&token.to_uppercase()));
    let Some(token_info) = token_info else {
        return Ok(None);
    };
    if let Some(d) = chain_detail(token_info, chain_id).and_then(|c| c.get("decimals")) {
        return Ok(d.as_i64());
    }
    Ok(token_info.get("decimals").and_then(|d| d.as_i64()))
}

pub async fn is_supported_chain(chain_id: i64, network: Network) -> Result<bool, AppError> {
    Ok(get_chain_info(chain_id, network).await?.is_some())
}

pub async fn get_withdrawal_fee(
    token: &str,
    chain_id: i64,
    network: Network,
) -> Result<Option<(f64, f64)>, AppError> {
    let tokens = fetch_token_info(network).await?;
    let token_info = tokens
        .iter()
        .find(|t| t.get("token").and_then(|v| v.as_str()) == Some(&token.to_uppercase()));
    let Some(token_info) = token_info else {
        return Ok(None);
    };
    let Some(detail) = chain_detail(token_info, chain_id) else {
        return Ok(None);
    };
    let fee = detail
        .get("withdrawal_fee")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let cross = detail
        .get("cross_chain_withdrawal_fee")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    Ok(Some((fee, cross)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rows_extraction_variants() {
        assert_eq!(rows_of(&json!({"data": {"rows": [1, 2]}})).len(), 2);
        assert_eq!(rows_of(&json!({"rows": [1]})).len(), 1);
        assert_eq!(rows_of(&json!({})).len(), 0);
    }

    #[test]
    fn chain_id_matching() {
        assert!(number_eq_str(Some(&json!(421614)), 421614));
        assert!(number_eq_str(Some(&json!("421614")), 421614));
        assert!(!number_eq_str(Some(&json!(1)), 421614));
    }

    #[test]
    fn verifying_contracts() {
        assert_eq!(
            get_verifying_contract(Network::Testnet),
            "0x1826B75e2ef249173FC735149AE4B8e9ea10abff"
        );
        assert_eq!(
            get_verifying_contract(Network::Mainnet),
            "0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203"
        );
    }
}
