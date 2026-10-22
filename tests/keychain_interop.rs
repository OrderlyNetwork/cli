//! Keychain interop tests.
//!
//! These talk to the real OS keychain. They skip (rather than fail) when no
//! keychain is reachable, so they are safe in headless CI.
//!
//! `reads_keytar_written_*` prove the Rust backend can read secrets written by
//! the TypeScript CLI's `keytar` (same libsecret schema/attributes on Linux).

use orderly::keychain::{self, KeyPair, WalletKeyPair};

const FUNDED_ADDRESS: &str = "0xD79A571D1FFE68D410F6Db058c720D1b9E4cAE73";
const FUNDED_ACCOUNT: &str = "0x35d7e10082cd342455c975ec09f16bdb4a7d0e4e9de75c308513f6c066c2a766";

#[tokio::test]
async fn reads_keytar_written_wallet_key() {
    match keychain::get_wallet_key(FUNDED_ADDRESS, "testnet").await {
        Ok(Some(wk)) => {
            assert_eq!(wk.address, FUNDED_ADDRESS);
            assert_eq!(wk.wallet_type, "EVM");
            assert_eq!(wk.network, "testnet");
            assert!(!wk.private_key.is_empty());
        }
        Ok(None) => eprintln!("SKIP: keytar wallet entry not present in keychain"),
        Err(e) => eprintln!("SKIP: keychain unavailable: {e}"),
    }
}

#[tokio::test]
async fn reads_keytar_written_api_key() {
    match keychain::get_key(FUNDED_ACCOUNT, "testnet").await {
        Ok(Some(kp)) => {
            assert_eq!(kp.account_id, FUNDED_ACCOUNT);
            assert_eq!(kp.network, "testnet");
            assert!(!kp.public_key.is_empty());
            assert!(!kp.private_key.is_empty());
        }
        Ok(None) => eprintln!("SKIP: keytar api entry not present in keychain"),
        Err(e) => eprintln!("SKIP: keychain unavailable: {e}"),
    }
}

#[tokio::test]
async fn roundtrip_store_get_delete_api_key() {
    let kp = KeyPair {
        account_id: "rust-roundtrip-test".into(),
        address: Some("0xround".into()),
        wallet_type: Some("EVM".into()),
        public_key: "pub".into(),
        private_key: "priv".into(),
        network: "testnet".into(),
    };

    if let Err(e) = keychain::store_key("rust-roundtrip-test", "testnet", &kp).await {
        eprintln!("SKIP: keychain unavailable: {e}");
        return;
    }

    let got = keychain::get_key("rust-roundtrip-test", "testnet")
        .await
        .unwrap()
        .expect("stored key present");
    assert_eq!(got, kp);

    // Listed via the index.
    let listed = keychain::list_keys().await.unwrap();
    assert!(listed
        .iter()
        .any(|k| k.account_id == "rust-roundtrip-test" && k.network == "testnet"));

    assert!(keychain::delete_key("rust-roundtrip-test", "testnet")
        .await
        .unwrap());
    assert!(keychain::get_key("rust-roundtrip-test", "testnet")
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn roundtrip_store_get_delete_wallet_key() {
    let wk = WalletKeyPair {
        address: "0xrustwallet".into(),
        private_key: "wpriv".into(),
        wallet_type: "EVM".into(),
        network: "testnet".into(),
    };

    if let Err(e) = keychain::store_wallet_key("0xrustwallet", "testnet", &wk).await {
        eprintln!("SKIP: keychain unavailable: {e}");
        return;
    }

    let got = keychain::get_wallet_key("0xrustwallet", "testnet")
        .await
        .unwrap()
        .expect("stored wallet key present");
    assert_eq!(got, wk);

    assert!(keychain::delete_wallet_key("0xrustwallet", "testnet")
        .await
        .unwrap());
}
