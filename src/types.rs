//! Shared types mirroring `src/types.ts`.

use serde::{Deserialize, Serialize};

pub const ORDERLY_APP_ID: &str = "OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Network {
    Mainnet,
    Testnet,
}

impl Network {
    pub fn as_str(&self) -> &'static str {
        match self {
            Network::Mainnet => "mainnet",
            Network::Testnet => "testnet",
        }
    }

    pub fn parse(s: &str) -> Option<Network> {
        match s {
            "mainnet" => Some(Network::Mainnet),
            "testnet" => Some(Network::Testnet),
            _ => None,
        }
    }
}

impl std::fmt::Display for Network {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WalletType {
    Evm,
    Sol,
}

impl WalletType {
    pub fn as_str(&self) -> &'static str {
        match self {
            WalletType::Evm => "EVM",
            WalletType::Sol => "SOL",
        }
    }

    pub fn parse(s: &str) -> Option<WalletType> {
        match s.to_ascii_uppercase().as_str() {
            "EVM" => Some(WalletType::Evm),
            "SOL" => Some(WalletType::Sol),
            _ => None,
        }
    }
}

impl std::fmt::Display for WalletType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

pub struct NetworkUrls {
    pub api: &'static str,
    pub ws: String,
}

pub fn network_urls(network: Network) -> NetworkUrls {
    match network {
        Network::Mainnet => NetworkUrls {
            api: "https://api.orderly.org",
            ws: format!("wss://ws-evm.orderly.org/ws/stream/{ORDERLY_APP_ID}"),
        },
        Network::Testnet => NetworkUrls {
            api: "https://testnet-api.orderly.org",
            ws: format!("wss://testnet-ws-evm.orderly.org/ws/stream/{ORDERLY_APP_ID}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_roundtrip() {
        assert_eq!(Network::parse("mainnet"), Some(Network::Mainnet));
        assert_eq!(Network::parse("testnet"), Some(Network::Testnet));
        assert_eq!(Network::parse("bogus"), None);
        assert_eq!(Network::Testnet.as_str(), "testnet");
    }

    #[test]
    fn urls() {
        assert_eq!(
            network_urls(Network::Testnet).api,
            "https://testnet-api.orderly.org"
        );
        assert!(network_urls(Network::Mainnet).ws.contains(ORDERLY_APP_ID));
    }

    #[test]
    fn wallet_type_roundtrip() {
        assert_eq!(WalletType::parse("evm"), Some(WalletType::Evm));
        assert_eq!(WalletType::parse("SOL"), Some(WalletType::Sol));
        assert_eq!(WalletType::Sol.as_str(), "SOL");
    }
}
