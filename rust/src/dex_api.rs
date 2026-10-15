//! Orderly One DEX API client, mirroring `src/lib/dex-api.ts`.

use crate::error::AppError;
use crate::evm;
use crate::keychain::get_wallet_key;
use crate::types::Network;
use serde_json::{Map, Value};

pub fn base_url(network: Network) -> &'static str {
    match network {
        Network::Mainnet => "https://dex-api.orderly.network",
        Network::Testnet => "https://testnet-dex-api.orderly.network",
    }
}

/// Result of `getDex()`.
#[derive(Debug, Clone, Default)]
pub struct DexInfo {
    pub exists: bool,
    pub integration_type: Option<String>,
    pub broker_id: Option<String>,
    pub broker_name: Option<String>,
    pub is_graduated: Option<bool>,
    pub repo_url: Option<Value>,
}

pub struct DexApiClient {
    http: reqwest::Client,
    base_url: String,
    token: Option<String>,
}

impl DexApiClient {
    pub fn new(network: Network) -> Self {
        DexApiClient {
            http: reqwest::Client::new(),
            base_url: base_url(network).to_string(),
            token: None,
        }
    }

    async fn send_json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
        with_auth: bool,
    ) -> Result<Value, AppError> {
        let mut req = self
            .http
            .request(method, format!("{}{}", self.base_url, path));
        if with_auth {
            let token = self.token.as_ref().ok_or_else(|| {
                crate::commands::fail("Not authenticated. Call authenticate() first.")
            })?;
            req = req.header("Authorization", format!("Bearer {token}"));
        }
        req = req.header("Content-Type", "application/json");
        if let Some(body) = body {
            req = req.body(serde_json::to_string(body).unwrap_or_default());
        }
        self.finish(req).await
    }

    async fn finish(&self, req: reqwest::RequestBuilder) -> Result<Value, AppError> {
        let resp = req.send().await.map_err(|e| AppError::Msg(e.to_string()))?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if !(200..300).contains(&status) {
            return Err(AppError::Api { status, body: text });
        }
        if text.is_empty() {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
    }

    /// Authenticate with the DEX API using an EVM wallet signature.
    pub async fn authenticate(&mut self, address: &str, network: Network) -> Result<(), AppError> {
        let wallet_key = get_wallet_key(address, network.as_str())
            .await
            .map_err(AppError::Msg)?
            .ok_or_else(|| {
                crate::commands::fail(format!("No wallet found for {address} on {network}"))
            })?;

        if wallet_key.wallet_type != "EVM" {
            return Err(crate::commands::fail(
                "Dex API authentication requires an EVM wallet.",
            ));
        }

        let wallet =
            evm::EvmWallet::from_private_key(&evm::normalize_private_key(&wallet_key.private_key))
                .map_err(AppError::Msg)?;

        let nonce_body = crate::api::obj(vec![("address", Value::String(wallet.address.clone()))]);
        let nonce_res = self
            .send_json(
                reqwest::Method::POST,
                "/api/auth/nonce",
                Some(&nonce_body),
                false,
            )
            .await?;

        let message = nonce_res
            .get("message")
            .and_then(|m| m.as_str())
            .ok_or_else(|| crate::commands::fail("DEX API did not return a nonce message."))?;

        let signature = wallet.sign_message(message);

        let verify_body = crate::api::obj(vec![
            ("address", Value::String(wallet.address.clone())),
            ("signature", Value::String(signature)),
        ]);
        let verify_res = self
            .send_json(
                reqwest::Method::POST,
                "/api/auth/verify",
                Some(&verify_body),
                false,
            )
            .await?;

        let token = verify_res
            .get("token")
            .and_then(|t| t.as_str())
            .ok_or_else(|| {
                crate::commands::fail("DEX API authentication failed: no token returned.")
            })?;
        self.token = Some(token.to_string());
        Ok(())
    }

    pub async fn get_fee_options(&self, is_custom: bool) -> Result<Value, AppError> {
        let path = if is_custom {
            "/api/graduation/fee-options?isCustom=true"
        } else {
            "/api/graduation/fee-options"
        };
        self.send_json(reqwest::Method::GET, path, None, true).await
    }

    pub async fn get_dex(&self) -> DexInfo {
        let Ok(res) = self
            .send_json(reqwest::Method::GET, "/api/dex", None, true)
            .await
        else {
            return DexInfo::default();
        };

        if res.get("exists").and_then(|e| e.as_bool()) == Some(false) {
            return DexInfo::default();
        }

        DexInfo {
            exists: true,
            integration_type: res
                .get("integrationType")
                .and_then(|v| v.as_str())
                .map(String::from),
            broker_id: res
                .get("brokerId")
                .and_then(|v| v.as_str())
                .map(String::from),
            broker_name: res
                .get("brokerName")
                .and_then(|v| v.as_str())
                .map(String::from),
            is_graduated: res.get("isGraduated").and_then(|v| v.as_bool()),
            repo_url: res.get("repoUrl").cloned(),
        }
    }

    /// Create a custom-integration DEX. Uses a hand-rolled multipart body so the
    /// crate needs no extra reqwest features.
    pub async fn create_custom_dex(&self, broker_name: Option<&str>) -> Result<(), AppError> {
        let token = self.token.as_ref().ok_or_else(|| {
            crate::commands::fail("Not authenticated. Call authenticate() first.")
        })?;

        let boundary = format!("----orderlyboundary{}", crate::commands::now_ms());
        let mut body = String::new();
        body.push_str(&format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"integrationType\"\r\n\r\ncustom\r\n"
        ));
        if let Some(name) = broker_name {
            body.push_str(&format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"brokerName\"\r\n\r\n{name}\r\n"
            ));
        }
        body.push_str(&format!("--{boundary}--\r\n"));

        let req = self
            .http
            .post(format!("{}/api/dex", self.base_url))
            .header("Authorization", format!("Bearer {token}"))
            .header(
                "Content-Type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(body);
        self.finish(req).await.map(|_| ())
    }

    pub async fn verify_tx(&self, payload: &Value) -> Result<Value, AppError> {
        self.send_json(
            reqwest::Method::POST,
            "/api/graduation/verify-tx",
            Some(payload),
            true,
        )
        .await
    }

    pub async fn finalize_admin_wallet(&self) -> Result<Value, AppError> {
        let empty = Value::Object(Map::new());
        self.send_json(
            reqwest::Method::POST,
            "/api/graduation/finalize-admin-wallet",
            Some(&empty),
            true,
        )
        .await
    }
}
