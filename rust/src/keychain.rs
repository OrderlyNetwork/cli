//! Credential storage mirroring `src/lib/keychain.ts`.
//!
//! Secrets live in the OS keychain under the same service/account identifiers
//! that `keytar` used, so keys written by the TypeScript CLI remain readable:
//!
//! * service `orderly-cli`        — API keys, account `"{accountId}:{network}"`
//! * service `orderly-cli-wallet` — wallet keys, account `"{address}:{network}"`
//!
//! On Linux we speak to the Secret Service (libsecret) directly using the
//! `org.freedesktop.Secret.Generic` schema with `service`/`account` attributes,
//! exactly like keytar. On macOS/Windows we use the `keyring` crate.
//!
//! Enumeration (`keytar.findCredentials`) has no portable equivalent, so an
//! index file at `~/.orderly-cli/keys-index.json` records which credentials
//! exist. Secrets themselves are never written to disk.

use crate::config::{config_dir, home_dir};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const SERVICE_NAME: &str = "orderly-cli";
pub const SERVICE_NAME_WALLET: &str = "orderly-cli-wallet";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeyPair {
    #[serde(rename = "accountId")]
    pub account_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(rename = "walletType", skip_serializing_if = "Option::is_none")]
    pub wallet_type: Option<String>,
    #[serde(rename = "publicKey")]
    pub public_key: String,
    #[serde(rename = "privateKey")]
    pub private_key: String,
    pub network: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredKey {
    #[serde(rename = "accountId")]
    pub account_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(rename = "walletType", skip_serializing_if = "Option::is_none")]
    pub wallet_type: Option<String>,
    #[serde(rename = "publicKey")]
    pub public_key: String,
    pub network: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WalletKeyPair {
    pub address: String,
    #[serde(rename = "privateKey")]
    pub private_key: String,
    #[serde(rename = "walletType")]
    pub wallet_type: String,
    pub network: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredWalletKey {
    pub address: String,
    #[serde(rename = "walletType")]
    pub wallet_type: String,
    pub network: String,
}

pub fn make_key(account_id: &str, network: &str) -> String {
    format!("{account_id}:{network}")
}

pub fn make_wallet_key(address: &str, network: &str) -> String {
    format!("{address}:{network}")
}

// ---------------------------------------------------------------------------
// Index file (enumeration only; never contains secrets)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct IndexEntry {
    #[serde(rename = "accountId", skip_serializing_if = "Option::is_none")]
    account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    address: Option<String>,
    network: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct KeyIndex {
    #[serde(default)]
    keys: Vec<IndexEntry>,
    #[serde(default)]
    wallets: Vec<IndexEntry>,
}

pub fn index_path() -> PathBuf {
    config_dir().join("keys-index.json")
}

fn load_index() -> KeyIndex {
    match std::fs::read_to_string(index_path()) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => KeyIndex::default(),
    }
}

fn save_index(index: &KeyIndex) {
    let dir = config_dir();
    let _ = std::fs::create_dir_all(dir);
    if let Ok(data) = serde_json::to_string_pretty(index) {
        let _ = std::fs::write(index_path(), data);
    }
}

fn add_index_entry(keys: &mut Vec<IndexEntry>, entry: IndexEntry) {
    let exists = keys.iter().any(|e| {
        e.account_id == entry.account_id && e.address == entry.address && e.network == entry.network
    });
    if !exists {
        keys.push(entry);
    }
}

fn remove_index_entry(keys: &mut Vec<IndexEntry>, id: &str, network: &str, is_wallet: bool) {
    keys.retain(|e| {
        let matches_id = if is_wallet {
            e.address.as_deref() == Some(id)
        } else {
            e.account_id.as_deref() == Some(id)
        };
        !(matches_id && e.network == network)
    });
}

// ---------------------------------------------------------------------------
// Platform backends
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
mod backend {
    use secret_service::{EncryptionType, SecretService};
    use std::collections::HashMap;

    const CONTENT_TYPE: &str = "text/plain";

    async fn connect() -> Result<SecretService<'static>, String> {
        SecretService::connect(EncryptionType::Dh)
            .await
            .map_err(|e| format!("keychain connect failed: {e}"))
    }

    pub async fn store_password(
        service: &str,
        account: &str,
        password: &str,
    ) -> Result<(), String> {
        let ss = connect().await?;
        let collection = ss
            .get_default_collection()
            .await
            .map_err(|e| format!("keychain collection failed: {e}"))?;
        if collection
            .is_locked()
            .await
            .map_err(|e| format!("keychain lock check failed: {e}"))?
        {
            collection
                .unlock()
                .await
                .map_err(|e| format!("keychain unlock failed: {e}"))?;
        }
        let attributes = HashMap::from([("service", service), ("account", account)]);
        collection
            .create_item(
                &format!("{service}/{account}"),
                attributes,
                password.as_bytes(),
                true,
                CONTENT_TYPE,
            )
            .await
            .map_err(|e| format!("keychain store failed: {e}"))?;
        Ok(())
    }

    pub async fn get_password(service: &str, account: &str) -> Result<Option<String>, String> {
        let ss = connect().await?;
        let collection = ss
            .get_default_collection()
            .await
            .map_err(|e| format!("keychain collection failed: {e}"))?;
        if collection
            .is_locked()
            .await
            .map_err(|e| format!("keychain lock check failed: {e}"))?
        {
            collection
                .unlock()
                .await
                .map_err(|e| format!("keychain unlock failed: {e}"))?;
        }
        let attributes = HashMap::from([("service", service), ("account", account)]);
        let items = collection
            .search_items(attributes)
            .await
            .map_err(|e| format!("keychain search failed: {e}"))?;
        match items.first() {
            Some(item) => {
                let secret = item
                    .get_secret()
                    .await
                    .map_err(|e| format!("keychain read failed: {e}"))?;
                Ok(Some(String::from_utf8_lossy(&secret).to_string()))
            }
            None => Ok(None),
        }
    }

    pub async fn delete_password(service: &str, account: &str) -> Result<bool, String> {
        let ss = connect().await?;
        let collection = ss
            .get_default_collection()
            .await
            .map_err(|e| format!("keychain collection failed: {e}"))?;
        if collection
            .is_locked()
            .await
            .map_err(|e| format!("keychain lock check failed: {e}"))?
        {
            collection
                .unlock()
                .await
                .map_err(|e| format!("keychain unlock failed: {e}"))?;
        }
        let attributes = HashMap::from([("service", service), ("account", account)]);
        let items = collection
            .search_items(attributes)
            .await
            .map_err(|e| format!("keychain search failed: {e}"))?;
        if items.is_empty() {
            return Ok(false);
        }
        for item in items {
            item.delete()
                .await
                .map_err(|e| format!("keychain delete failed: {e}"))?;
        }
        Ok(true)
    }
}

#[cfg(not(target_os = "linux"))]
mod backend {
    use keyring::Entry;

    pub async fn store_password(
        service: &str,
        account: &str,
        password: &str,
    ) -> Result<(), String> {
        let entry = Entry::new(service, account).map_err(|e| e.to_string())?;
        entry.set_password(password).map_err(|e| e.to_string())
    }

    pub async fn get_password(service: &str, account: &str) -> Result<Option<String>, String> {
        let entry = Entry::new(service, account).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub async fn delete_password(service: &str, account: &str) -> Result<bool, String> {
        let entry = Entry::new(service, account).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(e.to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub async fn store_key(account_id: &str, network: &str, key: &KeyPair) -> Result<(), String> {
    let data = serde_json::to_string(key).map_err(|e| e.to_string())?;
    backend::store_password(SERVICE_NAME, &make_key(account_id, network), &data).await?;
    let mut index = load_index();
    add_index_entry(
        &mut index.keys,
        IndexEntry {
            account_id: Some(account_id.to_string()),
            address: None,
            network: network.to_string(),
        },
    );
    save_index(&index);
    Ok(())
}

pub async fn get_key(account_id: &str, network: &str) -> Result<Option<KeyPair>, String> {
    match backend::get_password(SERVICE_NAME, &make_key(account_id, network)).await? {
        Some(data) => serde_json::from_str(&data)
            .map(Some)
            .map_err(|e| format!("stored key is corrupt: {e}")),
        None => Ok(None),
    }
}

pub async fn delete_key(account_id: &str, network: &str) -> Result<bool, String> {
    let removed = backend::delete_password(SERVICE_NAME, &make_key(account_id, network)).await?;
    let mut index = load_index();
    remove_index_entry(&mut index.keys, account_id, network, false);
    save_index(&index);
    Ok(removed)
}

pub async fn has_key(account_id: &str, network: &str) -> bool {
    matches!(get_key(account_id, network).await, Ok(Some(_)))
}

pub async fn list_keys() -> Result<Vec<StoredKey>, String> {
    let index = load_index();
    let mut out = Vec::new();
    for entry in &index.keys {
        let Some(account_id) = &entry.account_id else {
            continue;
        };
        if let Some(key) = get_key(account_id, &entry.network).await? {
            out.push(StoredKey {
                account_id: key.account_id,
                address: key.address,
                wallet_type: key.wallet_type,
                public_key: key.public_key,
                network: key.network,
            });
        }
    }
    Ok(out)
}

pub async fn store_wallet_key(
    address: &str,
    network: &str,
    key: &WalletKeyPair,
) -> Result<(), String> {
    let data = serde_json::to_string(key).map_err(|e| e.to_string())?;
    backend::store_password(
        SERVICE_NAME_WALLET,
        &make_wallet_key(address, network),
        &data,
    )
    .await?;
    let mut index = load_index();
    add_index_entry(
        &mut index.wallets,
        IndexEntry {
            account_id: None,
            address: Some(address.to_string()),
            network: network.to_string(),
        },
    );
    save_index(&index);
    Ok(())
}

pub async fn get_wallet_key(address: &str, network: &str) -> Result<Option<WalletKeyPair>, String> {
    match backend::get_password(SERVICE_NAME_WALLET, &make_wallet_key(address, network)).await? {
        Some(data) => serde_json::from_str(&data)
            .map(Some)
            .map_err(|e| format!("stored wallet key is corrupt: {e}")),
        None => Ok(None),
    }
}

pub async fn delete_wallet_key(address: &str, network: &str) -> Result<bool, String> {
    let removed =
        backend::delete_password(SERVICE_NAME_WALLET, &make_wallet_key(address, network)).await?;
    let mut index = load_index();
    remove_index_entry(&mut index.wallets, address, network, true);
    save_index(&index);
    Ok(removed)
}

pub async fn has_wallet_key(address: &str, network: &str) -> bool {
    matches!(get_wallet_key(address, network).await, Ok(Some(_)))
}

pub async fn list_wallet_keys() -> Result<Vec<StoredWalletKey>, String> {
    let index = load_index();
    let mut out = Vec::new();
    for entry in &index.wallets {
        let Some(address) = &entry.address else {
            continue;
        };
        if let Some(key) = get_wallet_key(address, &entry.network).await? {
            out.push(StoredWalletKey {
                address: key.address,
                wallet_type: key.wallet_type,
                network: key.network,
            });
        }
    }
    Ok(out)
}

pub async fn get_wallet_key_by_type(
    wallet_type: &str,
    network: &str,
) -> Result<Option<WalletKeyPair>, String> {
    let keys = list_wallet_keys().await?;
    for key in keys {
        if key.wallet_type == wallet_type && key.network == network {
            return get_wallet_key(&key.address, network).await;
        }
    }
    Ok(None)
}

/// Directory used for the index file; exposed for tests.
pub fn _index_dir() -> PathBuf {
    home_dir().join(".orderly-cli")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_shapes_match_ts() {
        let kp = KeyPair {
            account_id: "0xabc".into(),
            address: Some("0xdef".into()),
            wallet_type: Some("EVM".into()),
            public_key: "pub".into(),
            private_key: "priv".into(),
            network: "testnet".into(),
        };
        assert_eq!(
            serde_json::to_string(&kp).unwrap(),
            r#"{"accountId":"0xabc","address":"0xdef","walletType":"EVM","publicKey":"pub","privateKey":"priv","network":"testnet"}"#
        );

        // KeyPair without address/walletType omits them (optional in TS).
        let kp2 = KeyPair {
            account_id: "1".into(),
            address: None,
            wallet_type: None,
            public_key: "p".into(),
            private_key: "s".into(),
            network: "mainnet".into(),
        };
        assert_eq!(
            serde_json::to_string(&kp2).unwrap(),
            r#"{"accountId":"1","publicKey":"p","privateKey":"s","network":"mainnet"}"#
        );

        let wk = WalletKeyPair {
            address: "0xdef".into(),
            private_key: "priv".into(),
            wallet_type: "EVM".into(),
            network: "testnet".into(),
        };
        assert_eq!(
            serde_json::to_string(&wk).unwrap(),
            r#"{"address":"0xdef","privateKey":"priv","walletType":"EVM","network":"testnet"}"#
        );
    }

    #[test]
    fn key_names() {
        assert_eq!(make_key("0xabc", "testnet"), "0xabc:testnet");
        assert_eq!(make_wallet_key("0xdef", "mainnet"), "0xdef:mainnet");
    }

    #[test]
    fn index_entry_dedup_and_remove() {
        let mut keys = Vec::new();
        let e = || IndexEntry {
            account_id: Some("a".into()),
            address: None,
            network: "testnet".into(),
        };
        add_index_entry(&mut keys, e());
        add_index_entry(&mut keys, e());
        assert_eq!(keys.len(), 1);
        remove_index_entry(&mut keys, "a", "testnet", false);
        assert!(keys.is_empty());
    }
}
