//! Solana wallet + signing, mirroring `src/lib/solana.ts`.
//!
//! Messages are hashed as `keccak256(abi.encode(...))`, hex-encoded, and then
//! the UTF-8 bytes of that hex string are signed with Ed25519 — exactly like the
//! TypeScript implementation.

use crate::crypto::keccak256;
use crate::types::Network;
use ed25519_dalek::{Signer, SigningKey};
use primitive_types::U256;
use serde_json::Value;

pub fn get_solana_chain_id(network: Network) -> u64 {
    match network {
        Network::Mainnet => 900900900,
        Network::Testnet => 901901901,
    }
}

pub struct SolanaWallet {
    pub address: String,
    pub private_key_bytes: [u8; 32],
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

/// Decode a Solana private key in base58, JSON-array, or hex form (32 or 64 bytes).
fn decode_private_key(private_key: &str) -> Result<Vec<u8>, String> {
    let mut key_bytes: Vec<u8>;
    if private_key.contains(',') || private_key.contains('[') {
        let cleaned = private_key.replace(['[', ']'], "");
        key_bytes = cleaned
            .split(',')
            .map(|n| n.trim().parse::<u8>())
            .collect::<Result<Vec<u8>, _>>()
            .map_err(|_| "Invalid Solana private key format".to_string())?;
    } else {
        match bs58::decode(private_key).into_vec() {
            Ok(bytes) => key_bytes = bytes,
            Err(_) => {
                let re = regex::Regex::new(r"^[a-fA-F0-9]+$").unwrap();
                if re.is_match(private_key) {
                    let hex = if private_key.len() == 64 {
                        &private_key[..64]
                    } else {
                        private_key
                    };
                    let mut out = vec![0u8; hex.len() / 2];
                    for i in 0..out.len() {
                        out[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
                            .map_err(|_| "Invalid Solana private key format".to_string())?;
                    }
                    key_bytes = out;
                } else {
                    return Err("Invalid Solana private key format".to_string());
                }
            }
        }
    }

    if key_bytes.len() == 64 {
        key_bytes.truncate(32);
    }
    if key_bytes.len() != 32 {
        return Err(format!(
            "Invalid private key length: {}, expected 32 or 64 bytes",
            key_bytes.len()
        ));
    }
    Ok(key_bytes)
}

pub fn create_solana_wallet_from_private_key(
    private_key: &str,
    _network: Network,
) -> Result<SolanaWallet, String> {
    let bytes = decode_private_key(private_key)?;
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&bytes);
    let signing_key = SigningKey::from_bytes(&seed);
    let address = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
    Ok(SolanaWallet {
        address,
        private_key_bytes: seed,
    })
}

pub fn is_valid_solana_address(address: &str) -> bool {
    match bs58::decode(address).into_vec() {
        Ok(decoded) => decoded.len() == 32,
        Err(_) => false,
    }
}

pub struct GeneratedSolanaWallet {
    pub address: String,
    pub private_key: String,
}

pub fn generate_solana_wallet() -> GeneratedSolanaWallet {
    let signing_key = SigningKey::generate(&mut rand::rngs::OsRng);
    let address = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
    let private_key = bs58::encode(signing_key.to_bytes()).into_string();
    GeneratedSolanaWallet {
        address,
        private_key,
    }
}

// ---------------------------------------------------------------------------
// ABI encoding (static types only: bytes32 / uint*)
// ---------------------------------------------------------------------------

fn abi_uint(value: &Value) -> [u8; 32] {
    let n = match value {
        Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                U256::from(u)
            } else if let Some(i) = n.as_i64() {
                U256::from(i as u64)
            } else {
                U256::from(n.as_f64().unwrap_or(0.0) as u64)
            }
        }
        Value::String(s) => U256::from_dec_str(s.trim()).unwrap_or(U256::zero()),
        _ => U256::zero(),
    };
    let mut out = [0u8; 32];
    n.to_big_endian(&mut out);
    out
}

fn abi_bytes32(bytes: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let n = bytes.len().min(32);
    out[..n].copy_from_slice(&bytes[..n]);
    out
}

fn solidity_string_hash(s: &str) -> [u8; 32] {
    keccak256(s.as_bytes())
}

fn abi_encode(words: &[[u8; 32]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(words.len() * 32);
    for w in words {
        out.extend_from_slice(w);
    }
    out
}

/// `keccak256(getBytes(abi.encode(...)))` rendered as the lowercase hex string
/// (no `0x`) that the CLI then signs.
fn msg_to_sign(words: &[[u8; 32]]) -> String {
    let encoded = abi_encode(words);
    bytes_to_hex(&keccak256(&encoded))
}

fn ed25519_sign_hex(wallet: &SolanaWallet, message: &str) -> String {
    let signing_key = SigningKey::from_bytes(&wallet.private_key_bytes);
    let signature = signing_key.sign(message.as_bytes());
    format!("0x{}", bytes_to_hex(&signature.to_bytes()))
}

// ---------------------------------------------------------------------------
// Signing flows
// ---------------------------------------------------------------------------

pub fn sign_registration(
    wallet: &SolanaWallet,
    broker_id: &str,
    timestamp: u64,
    registration_nonce: &str,
    network: Network,
) -> (Value, String) {
    let chain_id = get_solana_chain_id(network);
    let broker_id_hash = solidity_string_hash(broker_id);
    let words = [
        broker_id_hash,
        abi_uint(&Value::from(chain_id)),
        abi_uint(&Value::from(timestamp)),
        abi_uint(&Value::String(registration_nonce.to_string())),
    ];
    let message = crate::api::obj(vec![
        ("brokerId", Value::String(broker_id.to_string())),
        ("chainId", Value::from(chain_id)),
        ("timestamp", Value::from(timestamp)),
        (
            "registrationNonce",
            Value::String(registration_nonce.to_string()),
        ),
        ("chainType", Value::String("SOL".to_string())),
    ]);
    (message, ed25519_sign_hex(wallet, &msg_to_sign(&words)))
}

#[allow(clippy::too_many_arguments)]
pub fn sign_add_key(
    wallet: &SolanaWallet,
    broker_id: &str,
    public_key: &str,
    scope: &str,
    timestamp: u64,
    expiration: u64,
    network: Network,
) -> (Value, String) {
    let chain_id = get_solana_chain_id(network);
    let words = [
        solidity_string_hash(broker_id),
        solidity_string_hash(public_key),
        solidity_string_hash(scope),
        abi_uint(&Value::from(chain_id)),
        abi_uint(&Value::from(timestamp)),
        abi_uint(&Value::from(expiration)),
    ];
    let message = crate::api::obj(vec![
        ("brokerId", Value::String(broker_id.to_string())),
        ("chainType", Value::String("SOL".to_string())),
        ("orderlyKey", Value::String(public_key.to_string())),
        ("scope", Value::String(scope.to_string())),
        ("chainId", Value::from(chain_id)),
        ("timestamp", Value::from(timestamp)),
        ("expiration", Value::from(expiration)),
    ]);
    (message, ed25519_sign_hex(wallet, &msg_to_sign(&words)))
}

pub struct WithdrawParams {
    pub broker_id: String,
    pub chain_id: u64,
    pub receiver: String,
    pub token: String,
    pub amount: String,
    pub withdraw_nonce: String,
    pub timestamp: u64,
}

pub fn sign_withdraw(wallet: &SolanaWallet, params: &WithdrawParams) -> (Value, String) {
    let receiver_bytes = bs58::decode(&params.receiver)
        .into_vec()
        .unwrap_or_default();
    let salt = keccak256(b"Orderly Network");
    let words = [
        solidity_string_hash(&params.broker_id),
        solidity_string_hash(&params.token),
        abi_uint(&Value::from(params.chain_id)),
        abi_bytes32(&receiver_bytes),
        abi_uint(&Value::String(params.amount.clone())),
        abi_uint(&Value::String(params.withdraw_nonce.clone())),
        abi_uint(&Value::from(params.timestamp)),
        salt,
    ];
    let message = crate::api::obj(vec![
        ("brokerId", Value::String(params.broker_id.clone())),
        ("chainId", Value::from(params.chain_id)),
        ("receiver", Value::String(params.receiver.clone())),
        ("token", Value::String(params.token.clone())),
        ("amount", Value::String(params.amount.clone())),
        (
            "withdrawNonce",
            Value::String(params.withdraw_nonce.clone()),
        ),
        ("timestamp", Value::from(params.timestamp)),
        ("chainType", Value::String("SOL".to_string())),
    ]);
    (message, ed25519_sign_hex(wallet, &msg_to_sign(&words)))
}

pub fn sign_settle_pnl(
    wallet: &SolanaWallet,
    broker_id: &str,
    chain_id: u64,
    settle_nonce: &str,
    timestamp: u64,
) -> (Value, String) {
    let words = [
        solidity_string_hash(broker_id),
        abi_uint(&Value::from(chain_id)),
        abi_uint(&Value::String(settle_nonce.to_string())),
        abi_uint(&Value::from(timestamp)),
    ];
    let message = crate::api::obj(vec![
        ("brokerId", Value::String(broker_id.to_string())),
        ("chainId", Value::from(chain_id)),
        ("settleNonce", Value::String(settle_nonce.to_string())),
        ("timestamp", Value::from(timestamp)),
        ("chainType", Value::String("SOL".to_string())),
    ]);
    (message, ed25519_sign_hex(wallet, &msg_to_sign(&words)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chain_ids() {
        assert_eq!(get_solana_chain_id(Network::Mainnet), 900900900);
        assert_eq!(get_solana_chain_id(Network::Testnet), 901901901);
    }

    #[test]
    fn valid_address_check() {
        assert!(is_valid_solana_address("11111111111111111111111111111111"));
        assert!(!is_valid_solana_address("not-base58-!!!"));
    }

    #[test]
    fn generate_and_reimport() {
        let w = generate_solana_wallet();
        let reimported =
            create_solana_wallet_from_private_key(&w.private_key, Network::Testnet).unwrap();
        assert_eq!(reimported.address, w.address);
    }
}
