//! WebAssembly bindings for the Orderly CLI core.
//!
//! The native CLI keeps reqwest and the OS keychain. This crate exposes the
//! portable pieces: request construction, signing, and auth headers. The
//! JavaScript transport owns `fetch` and the signer.

use orderly::request::{self, RequestSpec, SigningKey};
use serde::Serialize;
use serde_json::{Map, Value};
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparedRequest {
    method: String,
    path: String,
    body: Option<String>,
    requires_auth: bool,
}

fn js_error(message: impl Into<String>) -> JsValue {
    JsValue::from_str(&message.into())
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value).map_err(|error| js_error(error.to_string()))
}

fn to_js_object<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value
        .serialize(&serializer)
        .map_err(|error| js_error(error.to_string()))
}

fn from_js(params: JsValue) -> Result<Value, JsValue> {
    serde_wasm_bindgen::from_value(params).map_err(|error| js_error(error.to_string()))
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut map = Map::new();
    for (key, value) in pairs {
        map.insert(key.to_string(), value);
    }
    Value::Object(map)
}

fn string(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("missing string parameter `{key}`"))
}

fn optional_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn number(value: &Value, key: &str) -> Result<f64, String> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("missing number parameter `{key}`"))
}

fn optional_number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn optional_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn js_number(value: f64) -> Value {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        Value::Number((value as i64).into())
    } else {
        serde_json::Number::from_f64(value)
            .map(Value::Number)
            .unwrap_or(Value::Null)
    }
}

fn js_num_str(value: f64) -> String {
    if value.is_finite() && value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

fn encode_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn query(pairs: Vec<(&str, Option<String>)>) -> String {
    let encoded: Vec<String> = pairs
        .into_iter()
        .filter_map(|(key, value)| {
            value.map(|value| format!("{}={}", encode_component(key), encode_component(&value)))
        })
        .collect();
    if encoded.is_empty() {
        String::new()
    } else {
        format!("?{}", encoded.join("&"))
    }
}

fn prepare_request(kind: &str, params: &Value) -> Result<(RequestSpec, bool), String> {
    let spec = match kind {
        "market" => RequestSpec::new("GET", "/v1/public/futures", None),
        "market_price" => {
            let symbol = string(params, "symbol")?;
            RequestSpec::new(
                "GET",
                format!("/v1/public/futures/{}", encode_component(&symbol)),
                None,
            )
        }
        "klines" => {
            let symbol = string(params, "symbol")?;
            let resolution = string(params, "resolution")?;
            let from = number(params, "from")? as i64;
            let to = number(params, "to")? as i64;
            RequestSpec::new(
                "GET",
                format!(
                    "/v1/tv/history?symbol={}&resolution={}&from={from}&to={to}",
                    encode_component(&symbol),
                    encode_component(&resolution)
                ),
                None,
            )
        }
        "positions" => {
            let product_type = optional_string(params, "productType");
            let suffix = query(vec![("product_type", product_type)]);
            RequestSpec::new("GET", format!("/v1/positions{suffix}"), None)
        }
        "balance" => RequestSpec::new("GET", "/v1/client/holding", None),
        "account" => RequestSpec::new("GET", "/v1/client/info", None),
        "orders" => {
            let suffix = query(vec![
                ("symbol", optional_string(params, "symbol")),
                ("status", optional_string(params, "status")),
                ("side", optional_string(params, "side")),
                ("order_type", optional_string(params, "orderType")),
                ("sort_by", optional_string(params, "sortBy")),
                (
                    "page",
                    optional_number(params, "page").map(|value| (value as i64).to_string()),
                ),
                (
                    "size",
                    optional_number(params, "size").map(|value| (value as i64).to_string()),
                ),
                ("product_type", optional_string(params, "productType")),
            ]);
            RequestSpec::new("GET", format!("/v1/orders{suffix}"), None)
        }
        "trades" => {
            let suffix = query(vec![
                ("symbol", optional_string(params, "symbol")),
                (
                    "size",
                    optional_number(params, "size").map(|value| (value as i64).to_string()),
                ),
                (
                    "page",
                    optional_number(params, "page").map(|value| (value as i64).to_string()),
                ),
                ("product_type", optional_string(params, "productType")),
            ]);
            RequestSpec::new("GET", format!("/v1/trades{suffix}"), None)
        }
        "order" => {
            let order_id = string(params, "orderId")?;
            RequestSpec::new(
                "GET",
                format!("/v1/order/{}", encode_component(&order_id)),
                None,
            )
        }
        "place_order" => {
            let symbol = string(params, "symbol")?.to_uppercase();
            let side = string(params, "side")?.to_uppercase();
            if side != "BUY" && side != "SELL" {
                return Err("side must be BUY or SELL".into());
            }
            let order_type = optional_string(params, "orderType")
                .unwrap_or_else(|| "MARKET".to_string())
                .to_uppercase();
            let quantity = match params.get("quantity") {
                Some(Value::String(value)) => value.clone(),
                Some(Value::Number(value)) => value.to_string(),
                _ => return Err("missing quantity parameter `quantity`".into()),
            };
            let mut pairs: Vec<(&str, Value)> = vec![
                ("symbol", Value::String(symbol)),
                ("order_type", Value::String(order_type)),
                ("side", Value::String(side)),
                ("order_quantity", Value::String(quantity)),
            ];
            if let Some(price) = optional_string(params, "price") {
                pairs.push(("order_price", Value::String(price)));
            } else if let Some(price) = optional_number(params, "price") {
                pairs.push(("order_price", Value::String(js_num_str(price))));
            }
            if let Some(client_order_id) = optional_string(params, "clientOrderId") {
                pairs.push(("client_order_id", Value::String(client_order_id)));
            }
            if optional_bool(params, "reduceOnly") == Some(true) {
                pairs.push(("reduce_only", Value::Bool(true)));
            }
            RequestSpec::new("POST", "/v1/order", Some(obj(pairs)))
        }
        "close_position" => {
            let symbol = string(params, "symbol")?.to_uppercase();
            let position_qty = number(params, "positionQty")?;
            if position_qty == 0.0 {
                return Err(format!("No open position found for {symbol}"));
            }
            let abs_qty = position_qty.abs();
            let partial = optional_number(params, "partialQuantity");
            if let Some(partial) = partial {
                if partial <= 0.0 {
                    return Err("Quantity must be positive".into());
                }
                if partial > abs_qty {
                    return Err(format!(
                        "Quantity {partial} exceeds position size {abs_qty}"
                    ));
                }
            }
            let quantity = partial.unwrap_or(abs_qty);
            let body = obj(vec![
                ("symbol", Value::String(symbol)),
                ("order_type", Value::String("MARKET".into())),
                (
                    "side",
                    Value::String(if position_qty > 0.0 { "SELL" } else { "BUY" }.into()),
                ),
                (
                    "order_quantity",
                    Value::String(js_num_str(quantity)),
                ),
                ("reduce_only", Value::Bool(true)),
            ]);
            RequestSpec::new("POST", "/v1/order", Some(body))
        }
        "set_leverage" => {
            let symbol = string(params, "symbol")?.to_uppercase();
            let leverage = number(params, "leverage")?;
            let body = obj(vec![
                ("symbol", Value::String(symbol)),
                ("leverage", js_number(leverage)),
            ]);
            RequestSpec::new("POST", "/v1/client/leverage", Some(body))
        }
        "get_leverage" => {
            let symbol = string(params, "symbol")?.to_uppercase();
            RequestSpec::new(
                "GET",
                format!(
                    "/v1/client/leverage?symbol={}",
                    encode_component(&symbol)
                ),
                None,
            )
        }
        "cancel_all" => {
            let suffix = query(vec![("symbol", optional_string(params, "symbol"))]);
            RequestSpec::new("DELETE", format!("/v1/orders{suffix}"), None)
        }
        "cancel_order" => {
            let order_id = string(params, "orderId")?;
            let suffix = query(vec![
                ("order_id", Some(order_id)),
                ("symbol", optional_string(params, "symbol")),
            ]);
            RequestSpec::new("DELETE", format!("/v1/order{suffix}"), None)
        }
        other => return Err(format!("unknown request kind `{other}`")),
    };

    let requires_auth = !matches!(kind, "market" | "market_price" | "klines");
    Ok((spec, requires_auth))
}

/// Build a request without signing it.
///
/// `params` is a JavaScript object. `body` is returned as the exact JSON string
/// the signer must cover, preserving key order.
#[wasm_bindgen]
pub fn prepare(kind: &str, params: JsValue) -> Result<JsValue, JsValue> {
    let params = from_js(params)?;
    let (spec, requires_auth) = prepare_request(kind, &params).map_err(js_error)?;
    let body = spec
        .body
        .as_ref()
        .map(|value| serde_json::to_string(value).map_err(|error| js_error(error.to_string())))
        .transpose()?;
    to_js(&PreparedRequest {
        method: spec.method,
        path: spec.path,
        body,
        requires_auth,
    })
}

/// The exact message covered by an Orderly signature.
#[wasm_bindgen]
pub fn message(timestamp: f64, method: &str, path: &str, body: Option<String>) -> String {
    request::message(timestamp as u128, method, path, body.as_deref())
}

/// Build the Orderly auth headers for a pre-computed signature.
#[wasm_bindgen]
pub fn headers(
    account_id: &str,
    public_key_base64: &str,
    signature: &str,
    timestamp: f64,
) -> Result<JsValue, JsValue> {
    let headers = request::auth_headers(
        account_id,
        public_key_base64,
        signature,
        timestamp as u128,
    );
    let map: Map<String, Value> = headers
        .into_iter()
        .map(|(key, value)| (key, Value::String(value)))
        .collect();
    to_js_object(&Value::Object(map))
}

/// Sign a message with a base64 Ed25519 seed. Returns base64url without padding.
#[wasm_bindgen]
pub fn sign(message: &str, private_key_base64: &str) -> String {
    orderly::crypto::sign(message, private_key_base64)
}

/// Verify a base64url signature against a standard-base64 public key.
#[wasm_bindgen]
pub fn verify(message: &str, signature_base64url: &str, public_key_base64: &str) -> bool {
    use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
    use base64::Engine;
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(signature_base64url) else {
        return false;
    };
    orderly::crypto::verify(message, &STANDARD.encode(bytes), public_key_base64)
}

/// Derive the standard-base64 public key from a base64 seed.
#[wasm_bindgen]
pub fn public_key_from_private_key(private_key_base64: &str) -> String {
    orderly::crypto::public_key_from_private_key(private_key_base64)
}

/// Convert a standard-base64 public key to the base58 header form.
#[wasm_bindgen]
pub fn public_key_base58(public_key_base64: &str) -> String {
    orderly::crypto::get_public_key_base58(public_key_base64)
}

/// Sign headers locally, used by the memory signer.
#[wasm_bindgen]
pub fn sign_headers(
    account_id: &str,
    public_key_base64: &str,
    private_key_base64: &str,
    timestamp: f64,
    method: &str,
    path: &str,
    body: Option<String>,
) -> Result<JsValue, JsValue> {
    let key = SigningKey {
        account_id: account_id.to_string(),
        public_key: public_key_base64.to_string(),
        private_key: private_key_base64.to_string(),
    };
    let headers = request::sign_headers(
        &key,
        method,
        path,
        body.as_deref(),
        timestamp as u128,
    )
    .map_err(|error| js_error(format!("{error}")))?;
    let map: Map<String, Value> = headers
        .into_iter()
        .map(|(key, value)| (key, Value::String(value)))
        .collect();
    to_js_object(&Value::Object(map))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body_string(spec: &RequestSpec) -> Option<String> {
        spec.body
            .as_ref()
            .map(|value| serde_json::to_string(value).unwrap())
    }

    #[test]
    fn place_order_body_matches_cli_shape() {
        let params = serde_json::json!({
            "symbol": "perp_btc_usdc",
            "side": "buy",
            "orderType": "MARKET",
            "quantity": "0.002",
            "reduceOnly": true
        });
        let (spec, auth) = prepare_request("place_order", &params).unwrap();
        assert!(auth);
        assert_eq!(spec.method, "POST");
        assert_eq!(spec.path, "/v1/order");
        assert_eq!(
            body_string(&spec).unwrap(),
            r#"{"symbol":"PERP_BTC_USDC","order_type":"MARKET","side":"BUY","order_quantity":"0.002","reduce_only":true}"#
        );
    }

    #[test]
    fn close_position_is_reduce_only() {
        let params = serde_json::json!({
            "symbol": "PERP_BTC_USDC",
            "positionQty": -0.002,
            "partialQuantity": 0.001
        });
        let (spec, _) = prepare_request("close_position", &params).unwrap();
        assert_eq!(
            body_string(&spec).unwrap(),
            r#"{"symbol":"PERP_BTC_USDC","order_type":"MARKET","side":"BUY","order_quantity":"0.001","reduce_only":true}"#
        );
    }

    #[test]
    fn public_market_reads_do_not_require_auth() {
        let (spec, auth) = prepare_request("market", &serde_json::json!({})).unwrap();
        assert_eq!(spec.path, "/v1/public/futures");
        assert!(!auth);
    }
}
