//! EVM wallet + EIP-712 signing, mirroring `src/lib/evm.ts`.
//!
//! Signatures are produced with RFC6979 deterministic nonces and low-s
//! normalization, matching `ethers` byte-for-byte.

use crate::crypto::keccak256;
use crate::types::Network;
use k256::ecdsa::{RecoveryId, Signature as K256Signature, SigningKey, VerifyingKey};
use primitive_types::U256;
use serde_json::{Map, Value};

pub const EIP712_NAME: &str = "Orderly";
pub const EIP712_VERSION: &str = "1";
const EIP712_VERIFYING_CONTRACT: &str = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";

pub fn get_domain_chain_id(network: Network) -> u64 {
    match network {
        Network::Mainnet => 42161,
        Network::Testnet => 421614,
    }
}

#[derive(Debug, Clone)]
pub struct Domain {
    pub name: String,
    pub version: String,
    pub chain_id: U256,
    pub verifying_contract: String,
}

impl Domain {
    pub fn for_registration(chain_id: u64) -> Domain {
        Domain {
            name: EIP712_NAME.to_string(),
            version: EIP712_VERSION.to_string(),
            chain_id: U256::from(chain_id),
            verifying_contract: EIP712_VERIFYING_CONTRACT.to_string(),
        }
    }

    pub fn verifying(chain_id: u64, verifying_contract: &str) -> Domain {
        Domain {
            name: EIP712_NAME.to_string(),
            version: EIP712_VERSION.to_string(),
            chain_id: U256::from(chain_id),
            verifying_contract: verifying_contract.to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

pub struct EvmWallet {
    signing_key: SigningKey,
    pub address: String,
}

fn checksum_address(bytes: &[u8]) -> String {
    let lower = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let hash = keccak256(lower.as_bytes());
    let mut out = String::with_capacity(42);
    out.push_str("0x");
    for (i, ch) in lower.chars().enumerate() {
        let nibble = if i % 2 == 0 {
            hash[i / 2] >> 4
        } else {
            hash[i / 2] & 0x0f
        };
        if ch.is_ascii_digit() || nibble < 8 {
            out.push(ch);
        } else {
            out.push(ch.to_ascii_uppercase());
        }
    }
    out
}

fn address_from_verifying_key(vk: &VerifyingKey) -> String {
    let point = vk.to_encoded_point(false);
    let pub_bytes = &point.as_bytes()[1..]; // drop 0x04 prefix
    let hash = keccak256(pub_bytes);
    checksum_address(&hash[12..])
}

impl EvmWallet {
    /// Create from a `0x`-prefixed (or bare) 32-byte hex private key.
    pub fn from_private_key(private_key: &str) -> Result<EvmWallet, String> {
        let hex = private_key.strip_prefix("0x").unwrap_or(private_key);
        let bytes = hex::decode(hex).map_err(|_| "Invalid EVM private key".to_string())?;
        if bytes.len() != 32 {
            return Err("Invalid EVM private key length".to_string());
        }
        let signing_key =
            SigningKey::from_slice(&bytes).map_err(|_| "Invalid EVM private key".to_string())?;
        let address = address_from_verifying_key(signing_key.verifying_key());
        Ok(EvmWallet {
            signing_key,
            address,
        })
    }

    pub fn generate() -> EvmWallet {
        let signing_key = SigningKey::random(&mut rand::rngs::OsRng);
        let address = address_from_verifying_key(signing_key.verifying_key());
        EvmWallet {
            signing_key,
            address,
        }
    }

    pub fn private_key_hex(&self) -> String {
        format!("0x{}", hex::encode(self.signing_key.to_bytes()))
    }

    fn sign_prehash(&self, digest: &[u8; 32]) -> String {
        let (signature, recovery_id): (K256Signature, RecoveryId) = self
            .signing_key
            .sign_prehash_recoverable(digest)
            .expect("prehash signing");
        let sig_bytes = signature.to_bytes();
        let v = 27 + recovery_id.to_byte();
        format!("0x{}{:02x}", hex::encode(sig_bytes), v)
    }

    /// EIP-191 `personal_sign`.
    pub fn sign_message(&self, message: &str) -> String {
        let prefixed = format!(
            "\u{19}Ethereum Signed Message:\n{}{}",
            message.len(),
            message
        );
        let digest = keccak256(prefixed.as_bytes());
        self.sign_prehash(&digest)
    }

    /// EIP-712 typed-data signature.
    pub fn sign_typed_data(
        &self,
        domain: &Domain,
        type_name: &str,
        fields: &[(&str, &str)],
        values: &Map<String, Value>,
    ) -> String {
        let digest = eip712_digest(domain, type_name, fields, values);
        self.sign_prehash(&digest)
    }
}

// ---------------------------------------------------------------------------
// EIP-712 hashing
// ---------------------------------------------------------------------------

fn encode_type(type_name: &str, fields: &[(&str, &str)]) -> String {
    let inner = fields
        .iter()
        .map(|(t, n)| format!("{t} {n}"))
        .collect::<Vec<_>>()
        .join(",");
    format!("{type_name}({inner})")
}

fn value_to_u256(value: &Value) -> U256 {
    match value {
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
    }
}

fn u256_be(n: U256) -> [u8; 32] {
    let mut out = [0u8; 32];
    n.to_big_endian(&mut out);
    out
}

fn encode_field(type_name: &str, value: &Value) -> [u8; 32] {
    match type_name {
        "string" => {
            let s = value.as_str().unwrap_or("");
            keccak256(s.as_bytes())
        }
        "address" => {
            let s = value.as_str().unwrap_or("");
            let hex = s.strip_prefix("0x").unwrap_or(s);
            let bytes = hex::decode(hex).unwrap_or_default();
            let mut out = [0u8; 32];
            if bytes.len() == 20 {
                out[12..].copy_from_slice(&bytes);
            }
            out
        }
        _ => {
            let n = value_to_u256(value);
            u256_be(n)
        }
    }
}

fn domain_separator(domain: &Domain) -> [u8; 32] {
    let type_hash = keccak256(
        b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
    );
    let mut buf = Vec::with_capacity(32 * 5);
    buf.extend_from_slice(&type_hash);
    buf.extend_from_slice(&keccak256(domain.name.as_bytes()));
    buf.extend_from_slice(&keccak256(domain.version.as_bytes()));
    buf.extend_from_slice(&u256_be(domain.chain_id));
    buf.extend_from_slice(&encode_field(
        "address",
        &Value::String(domain.verifying_contract.clone()),
    ));
    keccak256(&buf)
}

fn hash_struct(type_name: &str, fields: &[(&str, &str)], values: &Map<String, Value>) -> [u8; 32] {
    let type_hash = keccak256(encode_type(type_name, fields).as_bytes());
    let mut buf = Vec::with_capacity(32 * (1 + fields.len()));
    buf.extend_from_slice(&type_hash);
    for (type_of, name) in fields {
        let value = values.get(*name).cloned().unwrap_or(Value::Null);
        buf.extend_from_slice(&encode_field(type_of, &value));
    }
    keccak256(&buf)
}

pub fn eip712_digest(
    domain: &Domain,
    type_name: &str,
    fields: &[(&str, &str)],
    values: &Map<String, Value>,
) -> [u8; 32] {
    let mut buf = Vec::with_capacity(66);
    buf.extend_from_slice(&[0x19, 0x01]);
    buf.extend_from_slice(&domain_separator(domain));
    buf.extend_from_slice(&hash_struct(type_name, fields, values));
    keccak256(&buf)
}

// ---------------------------------------------------------------------------
// Message types (mirror src/types.ts)
// ---------------------------------------------------------------------------

pub const REGISTRATION_FIELDS: &[(&str, &str)] = &[
    ("string", "brokerId"),
    ("uint256", "chainId"),
    ("uint64", "timestamp"),
    ("uint256", "registrationNonce"),
];

pub const ADD_KEY_FIELDS: &[(&str, &str)] = &[
    ("string", "brokerId"),
    ("uint256", "chainId"),
    ("string", "orderlyKey"),
    ("string", "scope"),
    ("uint64", "timestamp"),
    ("uint64", "expiration"),
];

pub const WITHDRAW_FIELDS: &[(&str, &str)] = &[
    ("string", "brokerId"),
    ("uint256", "chainId"),
    ("address", "receiver"),
    ("string", "token"),
    ("uint256", "amount"),
    ("uint64", "withdrawNonce"),
    ("uint64", "timestamp"),
];

pub const SETTLE_PNL_FIELDS: &[(&str, &str)] = &[
    ("string", "brokerId"),
    ("uint256", "chainId"),
    ("uint64", "settleNonce"),
    ("uint64", "timestamp"),
];

pub fn registration_values(message: &Value) -> Map<String, Value> {
    pick(
        message,
        &["brokerId", "chainId", "timestamp", "registrationNonce"],
    )
}

pub fn add_key_values(message: &Value) -> Map<String, Value> {
    pick(
        message,
        &[
            "brokerId",
            "chainId",
            "orderlyKey",
            "scope",
            "timestamp",
            "expiration",
        ],
    )
}

pub fn withdraw_values(message: &Map<String, Value>) -> Map<String, Value> {
    pick_map(
        message,
        &[
            "brokerId",
            "chainId",
            "receiver",
            "token",
            "amount",
            "withdrawNonce",
            "timestamp",
        ],
    )
}

pub fn settle_pnl_values(message: &Value) -> Map<String, Value> {
    pick(
        message,
        &["brokerId", "chainId", "settleNonce", "timestamp"],
    )
}

fn pick(source: &Value, keys: &[&str]) -> Map<String, Value> {
    let mut m = Map::new();
    for k in keys {
        m.insert(
            k.to_string(),
            source.get(*k).cloned().unwrap_or(Value::Null),
        );
    }
    m
}

fn pick_map(source: &Map<String, Value>, keys: &[&str]) -> Map<String, Value> {
    let mut m = Map::new();
    for k in keys {
        m.insert(
            k.to_string(),
            source.get(*k).cloned().unwrap_or(Value::Null),
        );
    }
    m
}

pub fn sign_registration(wallet: &EvmWallet, message: &Value) -> String {
    let chain_id = message
        .get("chainId")
        .and_then(|v| v.as_u64())
        .unwrap_or(421614);
    let domain = Domain::for_registration(chain_id);
    wallet.sign_typed_data(
        &domain,
        "Registration",
        REGISTRATION_FIELDS,
        &registration_values(message),
    )
}

pub fn sign_add_key(wallet: &EvmWallet, message: &Value) -> String {
    let chain_id = message
        .get("chainId")
        .and_then(|v| v.as_u64())
        .unwrap_or(421614);
    let domain = Domain::for_registration(chain_id);
    wallet.sign_typed_data(
        &domain,
        "AddOrderlyKey",
        ADD_KEY_FIELDS,
        &add_key_values(message),
    )
}

pub fn sign_withdraw(wallet: &EvmWallet, message: &Map<String, Value>, network: Network) -> String {
    let chain_id = message.get("chainId").and_then(|v| v.as_u64()).unwrap_or(0);
    let domain = Domain::verifying(chain_id, crate::contracts::get_verifying_contract(network));
    wallet.sign_typed_data(
        &domain,
        "Withdraw",
        WITHDRAW_FIELDS,
        &withdraw_values(message),
    )
}

pub fn sign_settle_pnl(wallet: &EvmWallet, message: &Value, network: Network) -> String {
    let chain_id = message.get("chainId").and_then(|v| v.as_u64()).unwrap_or(0);
    let domain = Domain::verifying(chain_id, crate::contracts::get_verifying_contract(network));
    wallet.sign_typed_data(
        &domain,
        "SettlePnl",
        SETTLE_PNL_FIELDS,
        &settle_pnl_values(message),
    )
}

pub fn get_registration_hash(message: &Value) -> String {
    let chain_id = message
        .get("chainId")
        .and_then(|v| v.as_u64())
        .unwrap_or(421614);
    let domain = Domain::for_registration(chain_id);
    hex0x(&eip712_digest(
        &domain,
        "Registration",
        REGISTRATION_FIELDS,
        &registration_values(message),
    ))
}

pub fn get_add_key_hash(message: &Value) -> String {
    let chain_id = message
        .get("chainId")
        .and_then(|v| v.as_u64())
        .unwrap_or(421614);
    let domain = Domain::for_registration(chain_id);
    hex0x(&eip712_digest(
        &domain,
        "AddOrderlyKey",
        ADD_KEY_FIELDS,
        &add_key_values(message),
    ))
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

pub fn is_valid_evm_address(address: &str) -> bool {
    let re = regex::Regex::new(r"^0x[a-fA-F0-9]{40}$").unwrap();
    re.is_match(address)
}

pub fn is_valid_private_key(key: &str) -> bool {
    let hex = key.strip_prefix("0x").unwrap_or(key);
    let re = regex::Regex::new(r"^[a-fA-F0-9]{64}$").unwrap();
    re.is_match(hex)
}

pub fn normalize_private_key(key: &str) -> String {
    if key.starts_with("0x") {
        key.to_string()
    } else {
        format!("0x{key}")
    }
}

/// `ethers.parseUnits(value, decimals)` — returns a decimal string of base units.
pub fn parse_units(value: &str, decimals: u32) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Invalid amount".to_string());
    }
    let (int_part, frac_part) = match value.split_once('.') {
        Some((i, f)) => (i, f),
        None => (value, ""),
    };
    if !int_part.chars().all(|c| c.is_ascii_digit())
        || !frac_part.chars().all(|c| c.is_ascii_digit())
    {
        return Err(format!("Invalid amount: {value}"));
    }
    if frac_part.len() > decimals as usize {
        return Err(format!(
            "fractional component exceeds decimals ({decimals})"
        ));
    }
    let mut frac = frac_part.to_string();
    while frac.len() < decimals as usize {
        frac.push('0');
    }
    let combined = format!("{int_part}{frac}");
    let trimmed = combined.trim_start_matches('0');
    Ok(if trimmed.is_empty() {
        "0".to_string()
    } else {
        trimmed.to_string()
    })
}

fn hex0x(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksum_known_address() {
        // Known EIP-55 vector: 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed
        let bytes = hex::decode("5aaeb6053f3e94c9b9a09f33669435e7ef1beaed").unwrap();
        assert_eq!(
            checksum_address(&bytes),
            "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
        );
    }

    #[test]
    fn address_and_key_validation() {
        assert!(is_valid_evm_address(
            "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
        ));
        assert!(!is_valid_evm_address("0x123"));
        assert!(is_valid_private_key(&format!("0x{}", "a".repeat(64))));
        assert!(is_valid_private_key(&"a".repeat(64)));
        assert!(!is_valid_private_key("abc"));
        assert_eq!(normalize_private_key("ab"), "0xab");
        assert_eq!(normalize_private_key("0xab"), "0xab");
    }

    #[test]
    fn parse_units_examples() {
        assert_eq!(parse_units("10.5", 6).unwrap(), "10500000");
        assert_eq!(parse_units("10000000", 6).unwrap(), "10000000000000");
        assert_eq!(parse_units("1", 18).unwrap(), "1000000000000000000");
        assert_eq!(parse_units("0.000001", 6).unwrap(), "1");
        assert!(parse_units("10.0000001", 6).is_err());
    }
}
