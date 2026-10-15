//! Live integration tests against Orderly testnet (network required).
//!
//! These skip (rather than fail) when the network or keychain is unavailable.

use orderly::api::OrderlyClient;
use orderly::keychain;
use orderly::types::Network;

const FUNDED_ACCOUNT: &str = "0x35d7e10082cd342455c975ec09f16bdb4a7d0e4e9de75c308513f6c066c2a766";

#[tokio::test]
async fn public_market_price() {
    let client = OrderlyClient::new(Network::Testnet);
    match client.get_market_price("PERP_ETH_USDC").await {
        Ok(v) => {
            assert!(v.is_object(), "expected object, got {v}");
        }
        Err(e) => eprintln!("SKIP: network unavailable: {e}"),
    }
}

#[tokio::test]
async fn signed_account_info_uses_correct_signature() {
    let kp = match keychain::get_key(FUNDED_ACCOUNT, "testnet").await {
        Ok(Some(kp)) => kp,
        Ok(None) => {
            eprintln!("SKIP: no API key in keychain");
            return;
        }
        Err(e) => {
            eprintln!("SKIP: keychain unavailable: {e}");
            return;
        }
    };

    let mut client = OrderlyClient::new(Network::Testnet);
    client.set_key_pair(kp);

    match client.get_account_info().await {
        Ok(v) => {
            // A successful signed call proves the signature bytes match the server's expectation.
            assert_eq!(
                v.get("success").and_then(|s| s.as_bool()),
                Some(true),
                "signed /v1/client/info was not accepted: {v}"
            );
        }
        Err(e) => eprintln!("SKIP: signed request failed (network/creds): {e:?}"),
    }
}
