//! Orderly REST client mirroring `src/lib/api.ts`.
//!
//! Signing is byte-identical to the TypeScript client:
//! `message = "{timestamp}{METHOD}{path}{body}"` where `body` is the exact JSON
//! string serialized with preserved key order, and `path` is the relative URL
//! including any query string.

use crate::config::get_api_base_url;
use crate::crypto;
use crate::error::AppError;
use crate::keychain::KeyPair;
use crate::types::Network;
use serde_json::{Map, Value};
use std::time::{SystemTime, UNIX_EPOCH};

/// Build a `Value::Object` preserving key insertion order.
pub fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

/// Serialize a number the way JS does: integral floats become integers.
pub fn js_number(f: f64) -> Value {
    if f.is_finite() && f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0 {
        Value::Number((f as i64).into())
    } else {
        serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null)
    }
}

/// `URLSearchParams` serializer: space → `+`, unreserved chars kept.
pub fn encode_form_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// `encodeURIComponent`: space → `%20`, keeps `!~*'()`.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// A `URLSearchParams`-style query builder that preserves insertion order and
/// skips falsy values exactly like the TS client.
#[derive(Default)]
pub struct Params {
    pairs: Vec<(String, String)>,
}

impl Params {
    pub fn new() -> Self {
        Params { pairs: Vec::new() }
    }
    pub fn add(&mut self, key: &str, value: impl ToString) {
        self.pairs.push((key.to_string(), value.to_string()));
    }
    pub fn add_if(&mut self, key: &str, value: Option<impl ToString>) {
        if let Some(v) = value {
            self.add(key, v);
        }
    }
    pub fn is_empty(&self) -> bool {
        self.pairs.is_empty()
    }
}

impl std::fmt::Display for Params {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = self
            .pairs
            .iter()
            .map(|(k, v)| format!("{}={}", encode_form_component(k), encode_form_component(v)))
            .collect::<Vec<_>>()
            .join("&");
        f.write_str(&s)
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub struct OrderlyClient {
    http: reqwest::Client,
    base_url: String,
    network: Network,
    key_pair: Option<KeyPair>,
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

impl OrderlyClient {
    pub fn new(network: Network) -> Self {
        OrderlyClient {
            http: reqwest::Client::new(),
            base_url: get_api_base_url(network).to_string(),
            network,
            key_pair: None,
        }
    }

    pub fn network(&self) -> Network {
        self.network
    }

    pub fn set_key_pair(&mut self, key_pair: KeyPair) {
        self.key_pair = Some(key_pair);
    }

    pub fn key_pair(&self) -> Option<&KeyPair> {
        self.key_pair.as_ref()
    }

    fn signature_headers(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        ts: u128,
    ) -> Result<Vec<(String, String)>, AppError> {
        let kp = self
            .key_pair
            .as_ref()
            .ok_or_else(|| AppError::Msg("No key pair set. Please authenticate first.".into()))?;
        let message = format!(
            "{ts}{}{}{}",
            method.to_uppercase(),
            path,
            body.unwrap_or("")
        );
        let signature = crypto::sign(&message, &kp.private_key);
        let pubkey_b58 = crypto::get_public_key_base58(&kp.public_key);
        Ok(vec![
            ("orderly-timestamp".to_string(), ts.to_string()),
            ("orderly-account-id".to_string(), kp.account_id.clone()),
            ("orderly-key".to_string(), format!("ed25519:{pubkey_b58}")),
            ("orderly-signature".to_string(), signature),
        ])
    }

    /// Core request routine. `path` is the relative URL (may include a query).
    pub async fn request(
        &self,
        method: &str,
        path: &str,
        data: Option<&Value>,
        requires_auth: bool,
    ) -> Result<Value, AppError> {
        let spec = RequestSpec::new(method, path, data.cloned());
        self.send_spec(&spec, requires_auth).await
    }

    /// Send a pre-built [`RequestSpec`]. The signer covers the exact method,
    /// path and serialized body, so callers that build a spec (including
    /// `--dry-run`) share the same payload logic.
    pub async fn send_spec(
        &self,
        spec: &RequestSpec,
        requires_auth: bool,
    ) -> Result<Value, AppError> {
        let method_upper = spec.method.to_uppercase();
        let body_string = spec
            .body
            .as_ref()
            .map(|d| serde_json::to_string(d).unwrap_or_default());

        let content_type = if method_upper == "GET" || method_upper == "DELETE" {
            "application/x-www-form-urlencoded"
        } else {
            "application/json"
        };

        let url = format!("{}{}", self.base_url, spec.path);
        let mut req = self
            .http
            .request(
                reqwest::Method::from_bytes(method_upper.as_bytes())
                    .map_err(|e| AppError::Msg(e.to_string()))?,
                &url,
            )
            .header("Content-Type", content_type);

        if requires_auth {
            let headers = self.signature_headers(
                &method_upper,
                &spec.path,
                body_string.as_deref(),
                now_ms(),
            )?;
            for (k, v) in headers {
                req = req.header(k, v);
            }
        }

        if let Some(body) = &body_string {
            req = req.body(body.clone());
        }

        let resp = req.send().await.map_err(|e| AppError::Msg(e.to_string()))?;

        let status = resp.status().as_u16();
        let text = resp
            .text()
            .await
            .map_err(|e| AppError::Msg(e.to_string()))?;

        if !(200..300).contains(&status) {
            return Err(AppError::Api { status, body: text });
        }

        if text.is_empty() {
            return Ok(Value::Null);
        }
        match serde_json::from_str(&text) {
            Ok(v) => Ok(v),
            Err(_) => Ok(Value::String(text)),
        }
    }

    pub async fn get(&self, path: &str) -> Result<Value, AppError> {
        self.request("GET", path, None, true).await
    }
    pub async fn get_public(&self, path: &str) -> Result<Value, AppError> {
        self.request("GET", path, None, false).await
    }
    pub async fn post(&self, path: &str, data: Option<&Value>) -> Result<Value, AppError> {
        self.request("POST", path, data, true).await
    }
    pub async fn post_public(&self, path: &str, data: Option<&Value>) -> Result<Value, AppError> {
        self.request("POST", path, data, false).await
    }
    pub async fn put(&self, path: &str, data: Option<&Value>) -> Result<Value, AppError> {
        self.request("PUT", path, data, true).await
    }
    pub async fn delete(&self, path: &str) -> Result<Value, AppError> {
        self.request("DELETE", path, None, true).await
    }

    // -----------------------------------------------------------------------
    // Account
    // -----------------------------------------------------------------------

    pub async fn get_account_info(&self) -> Result<Value, AppError> {
        self.get("/v1/client/info").await
    }

    pub async fn get_broker_id(&self, account_id: &str) -> Result<String, AppError> {
        let result = self
            .get_public(&format!("/v1/public/account?account_id={account_id}"))
            .await?;
        result
            .get("data")
            .and_then(|d| d.get("broker_id"))
            .and_then(|b| b.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| {
                AppError::Msg(format!(
                    "Could not resolve broker_id for account {account_id}"
                ))
            })
    }

    pub async fn get_balances(&self) -> Result<Value, AppError> {
        self.get("/v1/client/holding").await
    }

    pub async fn get_statistics(&self) -> Result<Value, AppError> {
        self.get("/v1/client/statistics").await
    }

    pub async fn get_liquidations(
        &self,
        symbol: Option<&str>,
        page: Option<i64>,
        size: Option<i64>,
    ) -> Result<Value, AppError> {
        let mut p = Params::new();
        p.add_if("symbol", symbol);
        p.add_if("page", page);
        p.add_if("size", size);
        let q = p.to_string();
        if q.is_empty() {
            self.get("/v1/liquidations").await
        } else {
            self.get(&format!("/v1/liquidations?{q}")).await
        }
    }

    pub async fn get_key_info(&self) -> Result<Value, AppError> {
        self.get("/v1/client/key_info").await
    }

    pub async fn remove_orderly_key(&self, orderly_key: &str) -> Result<Value, AppError> {
        let body = obj(vec![(
            "orderly_key",
            Value::String(orderly_key.to_string()),
        )]);
        self.post("/v1/client/remove_orderly_key", Some(&body))
            .await
    }

    // -----------------------------------------------------------------------
    // Orders
    // -----------------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    pub async fn get_orders(
        &self,
        symbol: Option<&str>,
        status: Option<&str>,
        side: Option<&str>,
        order_type: Option<&str>,
        sort_by: Option<&str>,
        page: Option<i64>,
        size: Option<i64>,
    ) -> Result<Value, AppError> {
        let mut p = Params::new();
        p.add_if("symbol", symbol);
        p.add_if("status", status);
        p.add_if("side", side);
        p.add_if("order_type", order_type);
        p.add_if("sort_by", sort_by);
        p.add_if("page", page);
        p.add_if("size", size);
        let q = p.to_string();
        if q.is_empty() {
            self.get("/v1/orders").await
        } else {
            self.get(&format!("/v1/orders?{q}")).await
        }
    }

    pub async fn get_order(&self, order_id: &str) -> Result<Value, AppError> {
        self.get(&format!("/v1/order/{order_id}")).await
    }

    pub fn place_order_spec(order: &Value) -> RequestSpec {
        RequestSpec::new("POST", "/v1/order", Some(order.clone()))
    }

    pub async fn place_order(&self, order: &Value) -> Result<Value, AppError> {
        self.send_spec(&Self::place_order_spec(order), true).await
    }

    pub fn cancel_order_spec(order_id: &str, symbol: Option<&str>) -> RequestSpec {
        let path = match symbol {
            Some(s) => format!("/v1/order?order_id={order_id}&symbol={s}"),
            None => format!("/v1/order?order_id={order_id}"),
        };
        RequestSpec::new("DELETE", path, None)
    }

    pub async fn cancel_order(
        &self,
        order_id: &str,
        symbol: Option<&str>,
    ) -> Result<Value, AppError> {
        self.send_spec(&Self::cancel_order_spec(order_id, symbol), true)
            .await
    }

    pub fn edit_order_spec(order_id: &str, updates: &Value, symbol: &str) -> RequestSpec {
        let mut m = Map::new();
        m.insert(
            "order_id".to_string(),
            js_number(order_id.parse().unwrap_or(0.0)),
        );
        m.insert("symbol".to_string(), Value::String(symbol.to_string()));
        if let Value::Object(u) = updates {
            for (k, v) in u {
                m.insert(k.clone(), v.clone());
            }
        }
        RequestSpec::new("PUT", "/v1/order", Some(Value::Object(m)))
    }

    pub async fn edit_order(
        &self,
        order_id: &str,
        updates: &Value,
        symbol: &str,
    ) -> Result<Value, AppError> {
        self.send_spec(&Self::edit_order_spec(order_id, updates, symbol), true)
            .await
    }

    pub async fn cancel_all_orders(&self, symbol: Option<&str>) -> Result<Value, AppError> {
        let path = match symbol {
            Some(s) => format!("/v1/orders?symbol={s}"),
            None => "/v1/orders".to_string(),
        };
        self.delete(&path).await
    }

    pub fn place_batch_order_spec(orders: &[Value]) -> RequestSpec {
        let body = obj(vec![("orders", Value::Array(orders.to_vec()))]);
        RequestSpec::new("POST", "/v1/batch-order", Some(body))
    }

    pub async fn place_batch_order(&self, orders: &[Value]) -> Result<Value, AppError> {
        self.send_spec(&Self::place_batch_order_spec(orders), true)
            .await
    }

    pub fn cancel_batch_orders_spec(order_ids: &[String]) -> RequestSpec {
        RequestSpec::new(
            "DELETE",
            format!("/v1/batch-order?order_ids={}", order_ids.join(",")),
            None,
        )
    }

    pub async fn cancel_batch_orders(&self, order_ids: &[String]) -> Result<Value, AppError> {
        self.send_spec(&Self::cancel_batch_orders_spec(order_ids), true)
            .await
    }

    pub async fn cancel_batch_orders_by_client_ids(
        &self,
        client_order_ids: &[String],
    ) -> Result<Value, AppError> {
        self.delete(&format!(
            "/v1/client/batch-order?client_order_ids={}",
            client_order_ids.join(",")
        ))
        .await
    }

    pub async fn cancel_order_by_client_id(
        &self,
        client_order_id: &str,
        symbol: &str,
    ) -> Result<Value, AppError> {
        self.delete(&format!(
            "/v1/client/order?client_order_id={}&symbol={symbol}",
            encode_uri_component(client_order_id)
        ))
        .await
    }

    pub async fn get_order_by_order_id(&self, order_id: &str) -> Result<Value, AppError> {
        self.get(&format!("/v1/order/{order_id}")).await
    }

    pub async fn get_order_by_client_id(&self, client_order_id: &str) -> Result<Value, AppError> {
        self.get(&format!(
            "/v1/client/order/{}",
            encode_uri_component(client_order_id)
        ))
        .await
    }

    pub async fn get_order_trades(&self, order_id: &str) -> Result<Value, AppError> {
        self.get(&format!("/v1/order/{order_id}/trades")).await
    }

    pub async fn get_algo_order_trades(&self, order_id: &str) -> Result<Value, AppError> {
        self.get(&format!("/v1/algo/order/{order_id}/trades")).await
    }

    // -----------------------------------------------------------------------
    // Positions
    // -----------------------------------------------------------------------

    pub async fn get_positions(&self) -> Result<Value, AppError> {
        self.get("/v1/positions").await
    }

    pub async fn get_position(&self, symbol: &str) -> Result<Value, AppError> {
        self.get(&format!("/v1/position/{symbol}")).await
    }

    pub async fn close_position(
        &self,
        symbol: &str,
        partial_quantity: Option<f64>,
    ) -> Result<Value, AppError> {
        let pos = self.get_position(symbol).await?;
        let ok = pos
            .get("success")
            .and_then(|s| s.as_bool())
            .unwrap_or(false);
        let data = pos.get("data").filter(|d| !d.is_null());
        if !ok || data.is_none() {
            return Err(AppError::Msg(format!(
                "No open position found for {symbol}"
            )));
        }
        let data = data.unwrap();
        let qty = data
            .get("position_qty")
            .and_then(|q| q.as_f64())
            .unwrap_or(0.0);
        let body = Self::close_position_body(symbol, qty, partial_quantity)?;
        self.place_order(&body).await
    }

    /// The reduce-only MARKET order that closes (part of) a position. Kept
    /// separate from the lookup so `--dry-run` can describe the request.
    pub fn close_position_body(
        symbol: &str,
        position_qty: f64,
        partial_quantity: Option<f64>,
    ) -> Result<Value, AppError> {
        let qty = position_qty;
        if qty == 0.0 {
            return Err(AppError::Msg(format!(
                "No open position found for {symbol}"
            )));
        }
        let side = if qty > 0.0 { "SELL" } else { "BUY" };
        let abs_qty = qty.abs();
        if let Some(pq) = partial_quantity {
            if pq <= 0.0 {
                return Err(AppError::Msg("Quantity must be positive".into()));
            }
            if pq > abs_qty {
                return Err(AppError::Msg(format!(
                    "Quantity {pq} exceeds position size {abs_qty}"
                )));
            }
        }
        let quantity = match partial_quantity {
            Some(pq) => js_f64_to_js_string(pq),
            None => js_f64_to_js_string(abs_qty),
        };
        Ok(obj(vec![
            ("symbol", Value::String(symbol.to_string())),
            ("order_type", Value::String("MARKET".to_string())),
            ("side", Value::String(side.to_string())),
            ("order_quantity", Value::String(quantity)),
            ("reduce_only", Value::Bool(true)),
        ]))
    }

    // -----------------------------------------------------------------------
    // Market data
    // -----------------------------------------------------------------------

    pub async fn get_market_price(&self, symbol: &str) -> Result<Value, AppError> {
        self.get_public(&format!("/v1/public/futures/{symbol}"))
            .await
    }

    pub async fn get_market_trades(
        &self,
        symbol: &str,
        limit: Option<i64>,
    ) -> Result<Value, AppError> {
        let mut p = Params::new();
        p.add("symbol", symbol);
        p.add_if("limit", limit);
        self.get_public(&format!("/v1/public/market_trades?{}", p))
            .await
    }

    pub async fn get_funding_rates(&self) -> Result<Value, AppError> {
        self.get_public("/v1/public/market_info/funding_history")
            .await
    }

    pub async fn get_symbols(&self) -> Result<Value, AppError> {
        self.get_public("/v1/public/info").await
    }

    pub async fn get_futures(&self) -> Result<Value, AppError> {
        self.get_public("/v1/public/futures").await
    }

    pub async fn get_price_changes(&self) -> Result<Value, AppError> {
        self.get_public("/v1/public/market_info/price_changes")
            .await
    }

    pub async fn get_open_interest(&self) -> Result<Value, AppError> {
        self.get_public("/v1/public/market_info/traders_open_interests")
            .await
    }

    pub async fn get_liquidated_positions(
        &self,
        symbol: Option<&str>,
        page: Option<i64>,
        size: Option<i64>,
    ) -> Result<Value, AppError> {
        let mut p = Params::new();
        p.add_if("symbol", symbol);
        p.add_if("page", page);
        p.add_if("size", size);
        let q = p.to_string();
        if q.is_empty() {
            self.get_public("/v1/public/liquidated_positions").await
        } else {
            self.get_public(&format!("/v1/public/liquidated_positions?{q}"))
                .await
        }
    }

    pub async fn get_system_info(&self) -> Result<Value, AppError> {
        self.get_public("/v1/public/system_info").await
    }

    // -----------------------------------------------------------------------
    // Leverage / trades / history
    // -----------------------------------------------------------------------

    pub async fn get_leverage(&self, symbol: &str) -> Result<Value, AppError> {
        self.get(&format!("/v1/client/leverage?symbol={symbol}"))
            .await
    }

    pub fn set_leverage_spec(symbol: &str, leverage: f64) -> RequestSpec {
        let body = obj(vec![
            ("symbol", Value::String(symbol.to_string())),
            ("leverage", js_number(leverage)),
        ]);
        RequestSpec::new("POST", "/v1/client/leverage", Some(body))
    }

    pub async fn set_leverage(&self, symbol: &str, leverage: f64) -> Result<Value, AppError> {
        self.send_spec(&Self::set_leverage_spec(symbol, leverage), true)
            .await
    }

    pub async fn get_trades(
        &self,
        symbol: Option<&str>,
        start_t: Option<i64>,
        end_t: Option<i64>,
        page: Option<i64>,
        size: Option<i64>,
    ) -> Result<Value, AppError> {
        let mut p = Params::new();
        p.add_if("symbol", symbol);
        p.add_if("start_t", start_t);
        p.add_if("end_t", end_t);
        p.add_if("page", page);
        p.add_if("size", size);
        let q = p.to_string();
        if q.is_empty() {
            self.get("/v1/trades").await
        } else {
            self.get(&format!("/v1/trades?{q}")).await
        }
    }

    pub async fn get_position_history(
        &self,
        symbol: Option<&str>,
        start_t: Option<i64>,
        end_t: Option<i64>,
        page: Option<i64>,
        limit: Option<i64>,
    ) -> Result<Value, AppError> {
        let mut p = Params::new();
        p.add_if("symbol", symbol);
        p.add_if("start_t", start_t);
        p.add_if("end_t", end_t);
        p.add("page", page.unwrap_or(1));
        p.add("limit", limit.unwrap_or(25));
        let mut result = self.get(&format!("/v1/position_history?{}", p)).await?;
        // TS normalizes `data.rows === null` → [].
        if let Some(rows) = result.get_mut("data").and_then(|d| d.get_mut("rows")) {
            if rows.is_null() {
                *rows = Value::Array(vec![]);
            }
        }
        Ok(result)
    }

    // -----------------------------------------------------------------------
    // Algo orders
    // -----------------------------------------------------------------------

    pub fn place_algo_order_spec(order: &Value) -> RequestSpec {
        RequestSpec::new("POST", "/v1/algo/order", Some(order.clone()))
    }

    pub async fn place_algo_order(&self, order: &Value) -> Result<Value, AppError> {
        self.send_spec(&Self::place_algo_order_spec(order), true)
            .await
    }

    pub async fn cancel_algo_order_by_client_id(
        &self,
        client_order_id: &str,
        symbol: &str,
    ) -> Result<Value, AppError> {
        self.delete(&format!(
            "/v1/algo/client/order?client_order_id={}&symbol={symbol}",
            encode_uri_component(client_order_id)
        ))
        .await
    }

    pub fn cancel_algo_order_spec(order_id: &str, symbol: &str) -> RequestSpec {
        RequestSpec::new(
            "DELETE",
            format!("/v1/algo/order?order_id={order_id}&symbol={symbol}"),
            None,
        )
    }

    pub async fn cancel_algo_order(&self, order_id: &str, symbol: &str) -> Result<Value, AppError> {
        self.send_spec(&Self::cancel_algo_order_spec(order_id, symbol), true)
            .await
    }

    pub async fn cancel_all_algo_orders(
        &self,
        symbol: Option<&str>,
        algo_type: Option<&str>,
    ) -> Result<Value, AppError> {
        let mut p = Params::new();
        p.add_if("symbol", symbol);
        p.add_if("algo_type", algo_type);
        let q = p.to_string();
        if q.is_empty() {
            self.delete("/v1/algo/orders").await
        } else {
            self.delete(&format!("/v1/algo/orders?{q}")).await
        }
    }

    pub async fn get_algo_orders(
        &self,
        symbol: Option<&str>,
        status: Option<&str>,
        page: Option<i64>,
        size: Option<i64>,
        algo_type: Option<&str>,
    ) -> Result<Value, AppError> {
        let mut p = Params::new();
        p.add_if("symbol", symbol);
        p.add_if("status", status);
        p.add_if("page", page);
        p.add_if("size", size);
        p.add_if("algo_type", algo_type);
        let q = p.to_string();
        if q.is_empty() {
            self.get("/v1/algo/orders").await
        } else {
            self.get(&format!("/v1/algo/orders?{q}")).await
        }
    }

    pub fn edit_algo_order_spec(order_id: &str, updates: &Value, symbol: &str) -> RequestSpec {
        let mut m = Map::new();
        m.insert(
            "order_id".to_string(),
            js_number(order_id.parse().unwrap_or(0.0)),
        );
        m.insert("symbol".to_string(), Value::String(symbol.to_string()));
        if let Value::Object(u) = updates {
            for (k, v) in u {
                m.insert(k.clone(), v.clone());
            }
        }
        RequestSpec::new("PUT", "/v1/algo/order", Some(Value::Object(m)))
    }

    pub async fn edit_algo_order(
        &self,
        order_id: &str,
        updates: &Value,
        symbol: &str,
    ) -> Result<Value, AppError> {
        self.send_spec(&Self::edit_algo_order_spec(order_id, updates, symbol), true)
            .await
    }

    pub async fn find_algo_order_by_id(&self, order_id: &str) -> Result<Value, AppError> {
        self.get(&format!("/v1/algo/order/{order_id}")).await
    }

    // -----------------------------------------------------------------------
    // Settle / referral / stats / notifications
    // -----------------------------------------------------------------------

    pub async fn get_settle_nonce(&self) -> Result<Value, AppError> {
        self.get("/v1/settle_nonce").await
    }

    pub async fn get_pnl_settlement_history(
        &self,
        page: Option<i64>,
        size: Option<i64>,
    ) -> Result<Value, AppError> {
        let mut p = Params::new();
        p.add("page", page.unwrap_or(1));
        p.add("size", size.unwrap_or(25));
        self.get(&format!("/v1/pnl_settlement/history?{}", p)).await
    }

    pub async fn get_referral_info(&self) -> Result<Value, AppError> {
        self.get("/v1/referral/info").await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn get_distribution_history(
        &self,
        status: Option<&str>,
        r#type: Option<&str>,
        start_t: Option<i64>,
        end_t: Option<i64>,
        page: Option<i64>,
        size: Option<i64>,
    ) -> Result<Value, AppError> {
        let mut p = Params::new();
        p.add_if("status", status);
        p.add_if("type", r#type);
        p.add_if("start_t", start_t);
        p.add_if("end_t", end_t);
        p.add("page", page.unwrap_or(1));
        p.add("size", size.unwrap_or(25));
        self.get(&format!("/v1/client/distribution_history?{}", p))
            .await
    }

    pub async fn get_volume_stats(&self) -> Result<Value, AppError> {
        self.get("/v1/volume/user/stats").await
    }

    pub async fn get_notification_inbox(
        &self,
        r#type: Option<&str>,
        page: Option<i64>,
        size: Option<i64>,
    ) -> Result<Value, AppError> {
        let mut p = Params::new();
        p.add_if("type", r#type);
        p.add("page", page.unwrap_or(1));
        p.add("size", size.unwrap_or(25));
        self.get(&format!("/v1/notification/inbox/notifications?{}", p))
            .await
    }

    pub async fn get_notification_inbox_unread(&self) -> Result<Value, AppError> {
        self.get("/v1/notification/inbox/unread").await
    }

    // -----------------------------------------------------------------------
    // Registration / keys
    // -----------------------------------------------------------------------

    pub async fn get_account(
        &self,
        address: &str,
        broker_id: &str,
        chain_type: Option<&str>,
    ) -> Result<Value, AppError> {
        let mut path = format!("/v1/get_account?address={address}&broker_id={broker_id}");
        if let Some(ct) = chain_type {
            path.push_str(&format!("&chain_type={ct}"));
        }
        self.get_public(&path).await
    }

    pub async fn get_registration_nonce(&self) -> Result<Value, AppError> {
        self.get_public("/v1/registration_nonce").await
    }

    pub async fn register_account(
        &self,
        message: &Value,
        signature: &str,
        user_address: &str,
        chain_type: Option<&str>,
    ) -> Result<Value, AppError> {
        let mut m = Map::new();
        m.insert("message".to_string(), message.clone());
        m.insert(
            "signature".to_string(),
            Value::String(signature.to_string()),
        );
        m.insert(
            "userAddress".to_string(),
            Value::String(user_address.to_string()),
        );
        if let Some(ct) = chain_type {
            m.insert("chain_type".to_string(), Value::String(ct.to_string()));
        }
        self.post_public("/v1/register_account", Some(&Value::Object(m)))
            .await
    }

    pub async fn add_orderly_key(
        &self,
        message: &Value,
        signature: &str,
        user_address: &str,
        chain_type: Option<&str>,
    ) -> Result<Value, AppError> {
        let mut m = Map::new();
        m.insert("message".to_string(), message.clone());
        m.insert(
            "signature".to_string(),
            Value::String(signature.to_string()),
        );
        m.insert(
            "userAddress".to_string(),
            Value::String(user_address.to_string()),
        );
        if let Some(ct) = chain_type {
            m.insert("chain_type".to_string(), Value::String(ct.to_string()));
        }
        self.post_public("/v1/orderly_key", Some(&Value::Object(m)))
            .await
    }

    pub async fn get_supported_chains(&self) -> Result<Value, AppError> {
        self.get_public("/v1/public/chain_info").await
    }

    // -----------------------------------------------------------------------
    // Faucet (testnet operator, unsigned)
    // -----------------------------------------------------------------------

    pub async fn faucet_usdc(
        &self,
        user_address: &str,
        broker_id: &str,
        chain_id: Option<&str>,
    ) -> Result<Value, AppError> {
        if self.network != Network::Testnet {
            return Err(AppError::Msg(
                "Faucet is only available on testnet. Use --network testnet.".into(),
            ));
        }
        let is_solana = !user_address.starts_with("0x");
        let faucet_base_url = if is_solana {
            "https://testnet-operator-sol.orderly.org"
        } else {
            "https://testnet-operator-evm.orderly.org"
        };

        let mut m = Map::new();
        m.insert(
            "user_address".to_string(),
            Value::String(user_address.to_string()),
        );
        m.insert(
            "broker_id".to_string(),
            Value::String(broker_id.to_string()),
        );
        if let Some(cid) = chain_id {
            if !is_solana {
                m.insert("chain_id".to_string(), Value::String(cid.to_string()));
            }
        }

        let resp = reqwest::Client::new()
            .post(format!("{faucet_base_url}/v1/faucet/usdc"))
            .header("Content-Type", "application/json")
            .body(serde_json::to_string(&Value::Object(m)).unwrap_or_default())
            .send()
            .await
            .map_err(|e| AppError::Msg(e.to_string()))?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if !(200..300).contains(&status) {
            return Err(AppError::Api { status, body: text });
        }
        Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
    }
}

/// JS-style number → string for quantities (integral values have no `.0`).
pub fn js_f64_to_js_string(f: f64) -> String {
    crate::output::js_f64_to_string(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn form_encoding_matches_urlsearchparams() {
        assert_eq!(encode_form_component("PERP_ETH_USDC"), "PERP_ETH_USDC");
        assert_eq!(encode_form_component("a b"), "a+b");
        assert_eq!(encode_form_component("a/b"), "a%2Fb");
        assert_eq!(encode_form_component("my-order-123"), "my-order-123");
        assert_eq!(encode_form_component("x&y=z"), "x%26y%3Dz");
    }

    #[test]
    fn uri_component_encoding() {
        assert_eq!(encode_uri_component("a b"), "a%20b");
        assert_eq!(encode_uri_component("a/b"), "a%2Fb");
        assert_eq!(encode_uri_component("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn params_preserve_order_and_skip_none() {
        let mut p = Params::new();
        p.add("symbol", "PERP_ETH_USDC");
        p.add_if("status", None::<String>);
        p.add("page", 1);
        assert_eq!(p.to_string(), "symbol=PERP_ETH_USDC&page=1");
    }

    #[test]
    fn js_number_integral() {
        assert_eq!(serde_json::to_string(&js_number(10.0)).unwrap(), "10");
        assert_eq!(serde_json::to_string(&js_number(10.5)).unwrap(), "10.5");
        assert_eq!(serde_json::to_string(&js_number(0.01)).unwrap(), "0.01");
    }

    #[test]
    fn obj_preserves_insertion_order() {
        let v = obj(vec![
            ("symbol", Value::String("PERP_ETH_USDC".into())),
            ("order_type", Value::String("MARKET".into())),
            ("side", Value::String("BUY".into())),
            ("order_quantity", Value::String("0.01".into())),
        ]);
        assert_eq!(
            serde_json::to_string(&v).unwrap(),
            r#"{"symbol":"PERP_ETH_USDC","order_type":"MARKET","side":"BUY","order_quantity":"0.01"}"#
        );
    }
}
