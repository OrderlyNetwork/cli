//! WebSocket snapshot helper mirroring `src/lib/ws.ts`.
//!
//! Subscribes to `<symbol>@<topic>`, answers `ping` with `pong`, and resolves on
//! the first message that carries `topic` + non-null `data`.

use crate::config::get_ws_base_url;
use crate::types::Network;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio_tungstenite::tungstenite::Message;

pub struct WsSnapshot {
    pub success: bool,
    pub data: Option<Value>,
    pub error: Option<String>,
}

impl WsSnapshot {
    fn ok(data: Value) -> Self {
        WsSnapshot {
            success: true,
            data: Some(data),
            error: None,
        }
    }
    fn err(message: impl Into<String>) -> Self {
        WsSnapshot {
            success: false,
            data: None,
            error: Some(message.into()),
        }
    }
}

pub async fn fetch_ws_snapshot(
    symbol: &str,
    topic: &str,
    network: Network,
    timeout_ms: u64,
) -> WsSnapshot {
    let url = get_ws_base_url(network);
    let deadline = std::time::Duration::from_millis(timeout_ms);

    let result = tokio::time::timeout(deadline, async move {
        let (ws, _) = match tokio_tungstenite::connect_async(&url).await {
            Ok(pair) => pair,
            Err(_) => return WsSnapshot::err(format!("Failed to connect to WebSocket at {url}")),
        };
        let (mut write, mut read) = ws.split();

        let subscribe = serde_json::json!({
            "id": "cli_snapshot",
            "event": "subscribe",
            "topic": format!("{symbol}@{topic}"),
        });
        if write
            .send(Message::Text(subscribe.to_string()))
            .await
            .is_err()
        {
            return WsSnapshot::err(format!("Failed to send subscription to {url}"));
        }

        while let Some(msg) = read.next().await {
            let msg = match msg {
                Ok(m) => m,
                Err(_) => return WsSnapshot::err("WebSocket error".to_string()),
            };
            let text = match msg {
                Message::Text(t) => t.to_string(),
                Message::Binary(b) => String::from_utf8_lossy(&b).to_string(),
                Message::Close(_) => {
                    return WsSnapshot::err("WebSocket closed before receiving data".to_string())
                }
                _ => continue,
            };
            let parsed: Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if parsed.get("event").and_then(|e| e.as_str()) == Some("ping") {
                let _ = write
                    .send(Message::Text(r#"{"event":"pong"}"#.to_string()))
                    .await;
                continue;
            }

            if parsed.get("event").and_then(|e| e.as_str()) == Some("subscribe") {
                if parsed.get("success").and_then(|s| s.as_bool()) == Some(false) {
                    let msg = parsed
                        .get("errorMsg")
                        .and_then(|e| e.as_str())
                        .unwrap_or("Subscription failed");
                    return WsSnapshot::err(msg.to_string());
                }
                continue;
            }

            if parsed.get("topic").is_some() {
                if let Some(data) = parsed.get("data") {
                    if !data.is_null() {
                        return WsSnapshot::ok(data.clone());
                    }
                }
            }
        }
        WsSnapshot::err("WebSocket closed before receiving data".to_string())
    })
    .await;

    match result {
        Ok(snapshot) => snapshot,
        Err(_) => WsSnapshot::err(format!("WebSocket timeout after {timeout_ms}ms")),
    }
}
