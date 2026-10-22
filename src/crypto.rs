//! Ed25519 key generation and signing, mirroring `src/lib/crypto.ts`.
//!
//! * private/public keys are standard base64 (`Buffer.toString('base64')`)
//! * signatures are base64url without padding (`Buffer.toString('base64url')`)

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};
use sha3::{Digest, Keccak256};

pub struct GeneratedKeyPair {
    pub public_key: String,
    pub private_key: String,
}

pub fn generate_key_pair() -> GeneratedKeyPair {
    let signing = SigningKey::generate(&mut rand::rngs::OsRng);
    let public = signing.verifying_key();
    GeneratedKeyPair {
        public_key: STANDARD.encode(public.as_bytes()),
        private_key: STANDARD.encode(signing.to_bytes()),
    }
}

pub fn private_key_from_base64(base64_key: &str) -> Vec<u8> {
    STANDARD.decode(base64_key).unwrap_or_default()
}

pub fn public_key_from_private_key(private_key_base64: &str) -> String {
    let bytes = private_key_from_base64(private_key_base64);
    let sk = signing_key_from_bytes(&bytes);
    STANDARD.encode(sk.verifying_key().as_bytes())
}

fn signing_key_from_bytes(bytes: &[u8]) -> SigningKey {
    let seed: [u8; 32] = bytes.try_into().expect("private key must be 32 bytes");
    SigningKey::from_bytes(&seed)
}

/// Sign a UTF-8 message; returns a base64url (unpadded) signature.
pub fn sign(message: &str, private_key_base64: &str) -> String {
    let bytes = private_key_from_base64(private_key_base64);
    let sk = signing_key_from_bytes(&bytes);
    let signature = sk.sign(message.as_bytes());
    URL_SAFE_NO_PAD.encode(signature.to_bytes())
}

/// Verify a standard-base64 signature over a UTF-8 message.
pub fn verify(message: &str, signature_base64: &str, public_key_base64: &str) -> bool {
    let pk_bytes = match STANDARD.decode(public_key_base64) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let sig_bytes = match STANDARD.decode(signature_base64) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let pk_arr: [u8; 32] = match pk_bytes.try_into() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let sig_arr: [u8; 64] = match sig_bytes.try_into() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let vk = match VerifyingKey::from_bytes(&pk_arr) {
        Ok(k) => k,
        Err(_) => return false,
    };
    let sig = ed25519_dalek::Signature::from_bytes(&sig_arr);
    vk.verify(message.as_bytes(), &sig).is_ok()
}

pub fn base64_to_base58(base64_key: &str) -> String {
    let bytes = STANDARD.decode(base64_key).unwrap_or_default();
    bs58::encode(bytes).into_string()
}

pub fn base58_to_base64(base58_key: &str) -> String {
    match bs58::decode(base58_key).into_vec() {
        Ok(bytes) => STANDARD.encode(bytes),
        Err(_) => String::new(),
    }
}

pub fn get_public_key_base58(public_key_base64: &str) -> String {
    base64_to_base58(public_key_base64)
}

pub fn keccak256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keccak256_empty_vector() {
        assert_eq!(
            hex(&keccak256(b"")),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        );
    }

    #[test]
    fn keccak256_abc_vector() {
        assert_eq!(
            hex(&keccak256(b"abc")),
            "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
        );
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn generate_sign_verify_roundtrip() {
        let kp = generate_key_pair();
        let msg = "1792047490101GET/v1/orders";
        let sig = sign(msg, &kp.private_key);
        assert!(!sig.contains('='));
        assert!(!sig.contains('+'));
        assert!(!sig.contains('/'));
        // Verify with standard-base64 signature.
        let sig_std =
            base64::engine::general_purpose::STANDARD.encode(URL_SAFE_NO_PAD.decode(&sig).unwrap());
        assert!(verify(msg, &sig_std, &kp.public_key));
        assert!(!verify("tampered", &sig_std, &kp.public_key));
    }

    #[test]
    fn public_key_derivation_is_stable() {
        let kp = generate_key_pair();
        assert_eq!(public_key_from_private_key(&kp.private_key), kp.public_key);
    }

    #[test]
    fn base58_roundtrip() {
        let kp = generate_key_pair();
        let b58 = get_public_key_base58(&kp.public_key);
        assert_eq!(base58_to_base64(&b58), kp.public_key);
    }
}
