//! Parity test: Rust EVM signing must reproduce `ethers` signatures exactly.

use orderly::evm;
use orderly::types::Network;
use serde_json::Value;

fn fixture() -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("parity/fixtures/evm.json");
    let text = std::fs::read_to_string(&path)
        .expect("run `node rust/parity/gen_evm_fixtures.mjs` to generate fixtures");
    serde_json::from_str(&text).expect("valid fixture json")
}

#[test]
fn evm_matches_ethers() {
    let f = fixture();
    let pk = f["privateKey"].as_str().unwrap();
    let wallet = evm::EvmWallet::from_private_key(pk).unwrap();

    assert_eq!(
        wallet.address,
        f["address"].as_str().unwrap(),
        "address mismatch"
    );

    // personal_sign
    assert_eq!(
        wallet.sign_message(f["personalSign"]["message"].as_str().unwrap()),
        f["personalSign"]["signature"].as_str().unwrap(),
        "personal_sign mismatch"
    );

    // Registration
    let reg = &f["registration"]["message"];
    assert_eq!(
        evm::get_registration_hash(reg),
        f["registration"]["hash"].as_str().unwrap(),
        "registration hash mismatch"
    );
    assert_eq!(
        evm::sign_registration(&wallet, reg),
        f["registration"]["signature"].as_str().unwrap(),
        "registration signature mismatch"
    );

    // Add key
    let ak = &f["addKey"]["message"];
    assert_eq!(
        evm::get_add_key_hash(ak),
        f["addKey"]["hash"].as_str().unwrap(),
        "addKey hash mismatch"
    );
    assert_eq!(
        evm::sign_add_key(&wallet, ak),
        f["addKey"]["signature"].as_str().unwrap(),
        "addKey signature mismatch"
    );

    // Withdraw (testnet + mainnet use different verifying contracts)
    let w = f["withdrawTestnet"]["message"].as_object().unwrap().clone();
    assert_eq!(
        evm::sign_withdraw(&wallet, &w, Network::Testnet),
        f["withdrawTestnet"]["signature"].as_str().unwrap(),
        "withdraw testnet signature mismatch"
    );
    let wm = f["withdrawMainnet"]["message"].as_object().unwrap().clone();
    assert_eq!(
        evm::sign_withdraw(&wallet, &wm, Network::Mainnet),
        f["withdrawMainnet"]["signature"].as_str().unwrap(),
        "withdraw mainnet signature mismatch"
    );

    // Settle PnL
    let st = &f["settlePnlTestnet"]["message"];
    assert_eq!(
        evm::sign_settle_pnl(&wallet, st, Network::Testnet),
        f["settlePnlTestnet"]["signature"].as_str().unwrap(),
        "settlePnl signature mismatch"
    );

    // Validation helpers
    assert_eq!(
        evm::is_valid_evm_address("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"),
        f["validation"]["validAddress"].as_bool().unwrap()
    );
    assert_eq!(
        evm::is_valid_evm_address("0x123"),
        f["validation"]["invalidAddress"].as_bool().unwrap()
    );
    assert_eq!(
        evm::is_valid_private_key(pk),
        f["validation"]["validKey"].as_bool().unwrap()
    );
    assert_eq!(
        evm::is_valid_private_key("abc"),
        f["validation"]["invalidKey"].as_bool().unwrap()
    );
    assert_eq!(
        evm::normalize_private_key("abcdef"),
        f["validation"]["normalized"].as_str().unwrap()
    );
}
