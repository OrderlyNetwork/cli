//! Config persistence mirroring `src/lib/config.ts`.
//!
//! Stored at `~/.orderly-cli/config.json`, pretty-printed with 2-space indent.

use crate::types::{network_urls, Network};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const CONFIG_DIR: &str = ".orderly-cli";
const CONFIG_FILE: &str = "config.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OrderlyConfig {
    #[serde(rename = "defaultNetwork", skip_serializing_if = "Option::is_none")]
    pub default_network: Option<Network>,
}

pub fn home_dir() -> PathBuf {
    if let Some(h) = std::env::var_os("HOME") {
        return PathBuf::from(h);
    }
    if let Some(h) = std::env::var_os("USERPROFILE") {
        return PathBuf::from(h);
    }
    if let (Ok(drive), Ok(path)) = (std::env::var("HOMEDRIVE"), std::env::var("HOMEPATH")) {
        return PathBuf::from(format!("{drive}{path}"));
    }
    PathBuf::from(".")
}

pub fn config_dir() -> PathBuf {
    home_dir().join(CONFIG_DIR)
}

pub fn config_path() -> PathBuf {
    config_dir().join(CONFIG_FILE)
}

pub fn load_config() -> OrderlyConfig {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => OrderlyConfig::default(),
    }
}

pub fn save_config(config: &OrderlyConfig) -> std::io::Result<()> {
    let dir = config_dir();
    fs::create_dir_all(&dir)?;
    let data = serde_json::to_string_pretty(config).unwrap_or_else(|_| "{}".to_string());
    fs::write(config_path(), data)
}

pub fn get_api_base_url(network: Network) -> &'static str {
    network_urls(network).api
}

pub fn get_ws_base_url(network: Network) -> String {
    network_urls(network).ws
}

pub fn get_default_network() -> Network {
    load_config().default_network.unwrap_or(Network::Testnet)
}

pub fn set_default_network(network: Network) {
    let mut config = load_config();
    config.default_network = Some(network);
    let _ = save_config(&config);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_match_ts() {
        assert_eq!(
            get_api_base_url(Network::Mainnet),
            "https://api.orderly.org"
        );
        assert_eq!(
            get_api_base_url(Network::Testnet),
            "https://testnet-api.orderly.org"
        );
    }

    #[test]
    fn config_roundtrip_serialization() {
        let cfg = OrderlyConfig {
            default_network: Some(Network::Mainnet),
        };
        let s = serde_json::to_string_pretty(&cfg).unwrap();
        assert_eq!(s, "{\n  \"defaultNetwork\": \"mainnet\"\n}");
        let back: OrderlyConfig = serde_json::from_str(&s).unwrap();
        assert_eq!(back.default_network, Some(Network::Mainnet));
    }

    #[test]
    fn empty_config_defaults() {
        let cfg = OrderlyConfig::default();
        assert!(cfg.default_network.is_none());
    }
}
