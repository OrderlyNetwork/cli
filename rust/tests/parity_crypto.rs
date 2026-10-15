//! Parity test: Rust crypto must reproduce the exact Ed25519 signatures and
//! base58 encodings produced by the TypeScript `src/lib/crypto.ts`.

use orderly::crypto;
use serde_json::Value;

#[test]
fn crypto_matches_ts_fixtures() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("parity/fixtures/crypto.json");
    let text = std::fs::read_to_string(&path)
        .expect("run `node rust/parity/gen_crypto_fixtures.mjs` to generate fixtures");
    let fixture: Value = serde_json::from_str(&text).expect("valid fixture json");

    let private_key = fixture["privateKey"].as_str().unwrap();
    let public_key = fixture["publicKey"].as_str().unwrap();

    assert_eq!(
        crypto::public_key_from_private_key(private_key),
        public_key,
        "public key derivation mismatch"
    );

    assert_eq!(
        crypto::get_public_key_base58(public_key),
        fixture["base58"].as_str().unwrap()
    );
    assert_eq!(
        crypto::base58_to_base64(fixture["base58"].as_str().unwrap()),
        fixture["base64FromBase58"].as_str().unwrap()
    );

    for v in fixture["vectors"].as_array().unwrap() {
        let name = v["name"].as_str().unwrap();
        let message = v["message"].as_str().unwrap();
        let expected_sig = v["signature"].as_str().unwrap();
        let got = crypto::sign(message, private_key);
        assert_eq!(got, expected_sig, "signature mismatch for `{name}`");

        // Round-trip verification using the standard-base64 form of the signature.
        let sig_std = base64_standard_from_url(expected_sig);
        assert!(
            crypto::verify(message, &sig_std, public_key),
            "verify failed for `{name}`"
        );
    }
}

fn base64_standard_from_url(sig: &str) -> String {
    use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
    use base64::Engine;
    let raw = URL_SAFE_NO_PAD.decode(sig).unwrap();
    STANDARD.encode(raw)
}
