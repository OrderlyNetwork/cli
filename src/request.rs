//! Portable request construction and Ed25519 auth headers.
//!
//! This module has no OS, network, or filesystem dependencies so it can be
//! compiled into the native CLI and into the WebAssembly SDK.

use crate::crypto;
use crate::error::AppError;
use serde_json::Value;

/// The key material needed to sign an authenticated request.
#[derive(Debug, Clone)]
pub struct SigningKey {
    pub account_id: String,
    pub public_key: String,
    pub private_key: String,
}

/// A request that can be inspected before it is sent (`--dry-run`).
#[derive(Debug, Clone)]
pub struct RequestSpec {
    pub method: String,
    pub path: String,
    pub body: Option<Value>,
}

impl RequestSpec {
    pub fn new(method: &str, path: impl Into<String>, body: Option<Value>) -> Self {
        RequestSpec {
            method: method.to_string(),
            path: path.into(),
            body,
        }
    }

    /// The `--dry-run` document: clearly a request, never a response.
    pub fn to_json(&self, note: Option<&str>, requires: &[&str]) -> Value {
        serde_json::json!({
            "dryRun": true,
            "method": self.method,
            "path": self.path,
            "body": self.body,
            "note": note,
            "requires": requires,
        })
    }
}

/// The exact bytes the CLI signs: `{timestamp}{METHOD}{path}{body}`.
pub fn message(timestamp: u128, method: &str, path: &str, body: Option<&str>) -> String {
    format!(
        "{timestamp}{}{}{}",
        method.to_uppercase(),
        path,
        body.unwrap_or("")
    )
}

/// Auth headers for a pre-computed signature. `public_key` is standard base64;
/// the wire header uses base58.
pub fn auth_headers(
    account_id: &str,
    public_key: &str,
    signature: &str,
    timestamp: u128,
) -> Vec<(String, String)> {
    let pubkey_b58 = crypto::get_public_key_base58(public_key);
    vec![
        ("orderly-timestamp".to_string(), timestamp.to_string()),
        ("orderly-account-id".to_string(), account_id.to_string()),
        ("orderly-key".to_string(), format!("ed25519:{pubkey_b58}")),
        ("orderly-signature".to_string(), signature.to_string()),
    ]
}

/// Sign and build headers with a local key.
pub fn sign_headers(
    key: &SigningKey,
    method: &str,
    path: &str,
    body: Option<&str>,
    timestamp: u128,
) -> Result<Vec<(String, String)>, AppError> {
    let message = message(timestamp, method, path, body);
    let signature = crypto::sign(&message, &key.private_key);
    Ok(auth_headers(
        &key.account_id,
        &key.public_key,
        &signature,
        timestamp,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIVATE_KEY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    #[test]
    fn message_matches_cli_format() {
        assert_eq!(
            message(1700000000000, "post", "/v1/order", Some("{\"a\":1}")),
            "1700000000000POST/v1/order{\"a\":1}"
        );
        assert_eq!(
            message(1700000000000, "GET", "/v1/positions", None),
            "1700000000000GET/v1/positions"
        );
    }

    #[test]
    fn headers_are_canonical() {
        let public_key = crypto::public_key_from_private_key(PRIVATE_KEY);
        let signature = crypto::sign("payload", PRIVATE_KEY);
        let headers = auth_headers("0xabc", &public_key, &signature, 42);
        assert_eq!(headers[0], ("orderly-timestamp".into(), "42".into()));
        assert_eq!(headers[1], ("orderly-account-id".into(), "0xabc".into()));
        assert!(headers[2].1.starts_with("ed25519:"));
        assert_eq!(headers[3].1, signature);
    }
}
