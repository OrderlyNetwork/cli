//! Parity test: Rust Solana signing must reproduce `src/lib/solana.ts` exactly
//! (both the message body JSON, including key order, and the signature).

use orderly::solana::{self, WithdrawParams};
use orderly::types::Network;
use serde_json::Value;

fn fixture() -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("parity/fixtures/solana.json");
    let text = std::fs::read_to_string(&path)
        .expect("run `node rust/parity/gen_solana_fixtures.mjs` to generate fixtures");
    serde_json::from_str(&text).expect("valid fixture json")
}

fn assert_message_eq(got: &Value, expected: &Value, label: &str) {
    assert_eq!(
        serde_json::to_string(got).unwrap(),
        serde_json::to_string(expected).unwrap(),
        "message mismatch for `{label}`"
    );
}

#[test]
fn solana_matches_ts() {
    let f = fixture();
    let private_key = f["privateKey"].as_str().unwrap();
    let wallet =
        solana::create_solana_wallet_from_private_key(private_key, Network::Testnet).unwrap();
    assert_eq!(
        wallet.address,
        f["address"].as_str().unwrap(),
        "address mismatch"
    );

    // Registration
    let (msg, sig) = solana::sign_registration(
        &wallet,
        "demo",
        1792047490101,
        "123456789",
        Network::Testnet,
    );
    assert_message_eq(&msg, &f["registration"]["message"], "registration");
    assert_eq!(sig, f["registration"]["signature"].as_str().unwrap());

    // Add key
    let (msg, sig) = solana::sign_add_key(
        &wallet,
        "demo",
        &wallet.address,
        "read,trading",
        1792047490101,
        1892047490101,
        Network::Testnet,
    );
    assert_message_eq(&msg, &f["addKey"]["message"], "addKey");
    assert_eq!(sig, f["addKey"]["signature"].as_str().unwrap());

    // Withdraw
    let params = WithdrawParams {
        broker_id: "demo".into(),
        chain_id: 901901901,
        receiver: wallet.address.clone(),
        token: "USDC".into(),
        amount: "10500000".into(),
        withdraw_nonce: "7".into(),
        timestamp: 1792047490101,
    };
    let (msg, sig) = solana::sign_withdraw(&wallet, &params);
    assert_message_eq(&msg, &f["withdraw"]["message"], "withdraw");
    assert_eq!(sig, f["withdraw"]["signature"].as_str().unwrap());

    // Settle PnL
    let (msg, sig) = solana::sign_settle_pnl(&wallet, "demo", 901901901, "3", 1792047490101);
    assert_message_eq(&msg, &f["settlePnl"]["message"], "settlePnl");
    assert_eq!(sig, f["settlePnl"]["signature"].as_str().unwrap());

    // Validation
    assert_eq!(
        solana::is_valid_solana_address(&wallet.address),
        f["validation"]["valid"].as_bool().unwrap()
    );
    assert_eq!(
        solana::is_valid_solana_address("nope"),
        f["validation"]["invalid"].as_bool().unwrap()
    );
}
