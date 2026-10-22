//! `src/commands/auth.ts`

use crate::account_select::{create_authenticated_client, is_tty, resolve_account_id};
use crate::api::{obj, OrderlyClient};
use crate::cli::Ctx;
use crate::colors;
use crate::config::set_default_network;
use crate::crypto;
use crate::error::AppError;
use crate::keychain::{self, KeyPair};
use crate::output::output;
use crate::types::Network;
use base64::Engine;
use serde_json::Value;
use std::io::IsTerminal;

fn wallet_type_label(key: &keychain::StoredKey) -> String {
    key.wallet_type
        .clone()
        .filter(|w| !w.is_empty())
        .unwrap_or_else(|| "Unknown".to_string())
}

/// `Buffer.from(value, 'base64')` length, mirroring Node's lenient decoding.
fn lenient_base64_len(value: &str) -> usize {
    let filtered: String = value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '+' || *c == '/')
        .collect();
    let mut padded = filtered.clone();
    while !padded.len().is_multiple_of(4) {
        padded.push('=');
    }
    base64::engine::general_purpose::STANDARD
        .decode(&padded)
        .map(|b| b.len())
        .unwrap_or(0)
}

/// Mirrors `normalizeEd25519PrivateKey`.
fn normalize_ed25519_private_key(key: &str) -> String {
    let mut k = key.trim().to_string();
    if let Some(rest) = k.strip_prefix("ed25519:") {
        k = rest.to_string();
    }
    let is_plain_base64 = regex::Regex::new(r"^[A-Za-z0-9+/]+=*$")
        .map(|re| re.is_match(&k))
        .unwrap_or(false);
    if lenient_base64_len(&k) == 32 && is_plain_base64 {
        return k;
    }
    crypto::base58_to_base64(&k)
}

fn invalid_key_error() -> AppError {
    super::fail(
        "Invalid key format. Provide a valid Ed25519 private key in base64, base58, or ed25519: prefixed format.",
    )
}

pub async fn import_key(
    private_key: Option<&str>,
    account: Option<&str>,
    ctx: Ctx,
) -> Result<(), AppError> {
    println!(
        "{}",
        colors::cyan(&format!("\n🔑 Import Existing Key ({})\n", ctx.network))
    );

    let mut key = private_key.unwrap_or("").to_string();
    let mut acc_id = account.unwrap_or("").to_string();

    if (key.is_empty() || acc_id.is_empty()) && !std::io::stdin().is_terminal() {
        return Err(super::fail(
            "Missing required arguments. Usage: orderly auth-import <private-key> --account <account-id>",
        ));
    }

    if key.is_empty() {
        key = super::prompt::password(
            "Enter your Ed25519 private key (base64, base58, or ed25519: prefixed)",
        )?
        .trim()
        .to_string();
        if key.is_empty() {
            return Err(super::fail("Cancelled."));
        }
    }

    if acc_id.is_empty() {
        acc_id = super::prompt::input("Enter your Orderly Account ID")?
            .trim()
            .to_string();
        if acc_id.is_empty() {
            return Err(super::fail("Cancelled."));
        }
    }

    let normalized_key = normalize_ed25519_private_key(&key);
    if crypto::private_key_from_base64(&normalized_key).len() != 32 {
        return Err(invalid_key_error());
    }
    let public_key = crypto::public_key_from_private_key(&normalized_key);

    let key_pair = KeyPair {
        account_id: acc_id.clone(),
        address: Some(String::new()),
        wallet_type: None,
        public_key: public_key.clone(),
        private_key: normalized_key,
        network: ctx.network.as_str().to_string(),
    };

    keychain::store_key(&acc_id, ctx.network.as_str(), &key_pair)
        .await
        .map_err(|e| super::fail(format!("Failed to store key: {e}")))?;

    set_default_network(ctx.network);

    println!();
    println!("{}", colors::green("✅ Key imported successfully!"));
    println!("{}", colors::dim(&format!("Account ID: {acc_id}")));
    println!("{}", colors::dim(&format!("Public key: {public_key}")));
    Ok(())
}

pub async fn list(network: Network, ctx: Ctx, ids_only: bool) -> Result<(), AppError> {
    let keys = keychain::list_keys().await.map_err(AppError::Msg)?;
    let filtered: Vec<keychain::StoredKey> = keys
        .into_iter()
        .filter(|k| k.network == network.as_str())
        .collect();

    if filtered.is_empty() {
        if !ids_only {
            println!(
                "{}",
                colors::yellow("No keys stored. Run `orderly wallet-add-key` to get started.")
            );
        }
        return Ok(());
    }

    if ids_only {
        for key in &filtered {
            println!("{}", key.account_id);
        }
        return Ok(());
    }

    let result: Vec<Value> = filtered
        .iter()
        .map(|key| {
            obj(vec![
                ("accountId", Value::String(key.account_id.clone())),
                (
                    "address",
                    Value::String(key.address.clone().unwrap_or_default()),
                ),
                ("network", Value::String(key.network.clone())),
                ("walletType", Value::String(wallet_type_label(key))),
                (
                    "publicKey",
                    Value::String(crypto::base64_to_base58(&key.public_key)),
                ),
            ])
        })
        .collect();

    output(&Value::Array(result), ctx.format);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn logout(
    account_id: Option<&str>,
    network: Network,
    force: bool,
) -> Result<(), AppError> {
    println!("{}", colors::cyan("\n🚪 Logout\n"));

    let mut acc_id = account_id.filter(|a| !a.is_empty()).map(String::from);

    if acc_id.is_none() {
        if !is_tty() {
            return Err(super::fail(
                "Error: --account is required in non-interactive mode.",
            ));
        }

        let keys = keychain::list_keys().await.map_err(AppError::Msg)?;
        let filtered: Vec<keychain::StoredKey> = keys
            .into_iter()
            .filter(|k| k.network == network.as_str())
            .collect();

        if filtered.is_empty() {
            println!(
                "{}",
                colors::yellow(&format!("No keys stored for {network}."))
            );
            return Ok(());
        }

        let items: Vec<String> = filtered
            .iter()
            .map(|k| format!("{} [{}]", k.account_id, k.network))
            .collect();
        let idx = super::prompt::select("Select account to logout", &items)?;
        acc_id = Some(filtered[idx].account_id.clone());
    }

    let Some(acc_id) = acc_id else {
        return Err(super::fail("No account selected."));
    };

    if !force {
        if !is_tty() {
            // prompts' confirm resolves to undefined without a TTY, which the TS CLI treats as "Cancelled.".
            return Err(super::fail("Cancelled."));
        }
        if !super::prompt::confirm(
            &format!("Remove key for account {acc_id} on {network}?"),
            false,
        )? {
            return Err(super::fail("Cancelled."));
        }
    }

    let deleted = keychain::delete_key(&acc_id, network.as_str())
        .await
        .map_err(|e| super::fail(format!("Failed to remove key: {e}")))?;
    if deleted {
        println!(
            "{}",
            colors::green(&format!("Key removed for {acc_id} on {network}"))
        );
    } else {
        println!(
            "{}",
            colors::yellow(&format!("No key found for {acc_id} on {network}"))
        );
    }
    Ok(())
}

pub async fn show(account: Option<&str>, network: Network, ctx: Ctx) -> Result<(), AppError> {
    let acc_id = resolve_account_id(account, network).await?;

    let Some(key) = keychain::get_key(&acc_id, network.as_str())
        .await
        .map_err(AppError::Msg)?
    else {
        output(
            &obj(vec![
                ("success", Value::Bool(false)),
                (
                    "message",
                    Value::String(format!("No key found for account {acc_id} on {network}")),
                ),
            ]),
            ctx.format,
        );
        // TS sets `process.exitCode = 1` here while still printing to stdout.
        std::process::exit(1);
    };

    let client = OrderlyClient::new(network);
    let broker_id = client.get_broker_id(&key.account_id).await.ok();

    let mut pairs = vec![
        ("accountId", Value::String(key.account_id.clone())),
        (
            "address",
            Value::String(key.address.clone().unwrap_or_default()),
        ),
        ("network", Value::String(key.network.clone())),
        (
            "walletType",
            Value::String(
                key.wallet_type
                    .clone()
                    .filter(|w| !w.is_empty())
                    .unwrap_or_else(|| "Unknown".to_string()),
            ),
        ),
        (
            "publicKey",
            Value::String(crypto::base64_to_base58(&key.public_key)),
        ),
    ];
    if let Some(broker_id) = broker_id {
        pairs.push(("brokerId", Value::String(broker_id)));
    }
    output(&obj(pairs), ctx.format);
    Ok(())
}

pub async fn cleanup(network: Network) -> Result<(), AppError> {
    println!("{}", colors::cyan("\n🧹 Cleaning up keys\n"));

    let keys = keychain::list_keys().await.map_err(AppError::Msg)?;
    let filtered: Vec<keychain::StoredKey> = keys
        .into_iter()
        .filter(|k| k.network == network.as_str())
        .collect();

    if filtered.is_empty() {
        println!(
            "{}",
            colors::green(&format!("No keys found for {network}."))
        );
        return Ok(());
    }

    println!(
        "{}",
        colors::yellow(&format!("Found {} key(s) for {network}:", filtered.len()))
    );
    for key in &filtered {
        println!("{}", colors::dim(&format!("  - {}", key.account_id)));
    }
    println!();

    if is_tty()
        && !super::prompt::confirm(&format!("Delete all {} key(s)?", filtered.len()), false)?
    {
        return Err(super::fail("Cancelled."));
    }

    let mut removed = 0;
    for key in &filtered {
        match keychain::delete_key(&key.account_id, network.as_str()).await {
            Ok(_) => {
                println!(
                    "{}",
                    colors::green(&format!("✓ Removed: {}", key.account_id))
                );
                removed += 1;
            }
            Err(err) => {
                println!(
                    "{}",
                    colors::red(&format!("Failed to remove {}: {err}", key.account_id))
                );
            }
        }
    }

    println!(
        "{}",
        colors::green(&format!("\n✅ Cleanup complete. {removed} key(s) removed."))
    );
    Ok(())
}

pub async fn export_key(account_id: Option<&str>, network: Network) -> Result<(), AppError> {
    if !is_tty() {
        return Err(super::fail(
            "This command requires an interactive terminal.",
        ));
    }
    println!("{}", colors::cyan("\n📤 Export API Key\n"));
    println!(
        "{}",
        colors::yellow("⚠️  WARNING: This will display your private key on screen.")
    );
    println!(
        "{}",
        colors::yellow("   Make sure no one is watching your screen.")
    );
    println!();

    let (_, key) = crate::account_select::resolve_key_pair(account_id, network).await?;

    println!("{} {}", colors::cyan("Account:"), key.account_id);
    println!("{} {}", colors::cyan("Network:"), key.network);
    println!();

    let confirm =
        super::prompt::input("Type \"EXPORT\" to confirm you want to export your private key:")?;
    if confirm != "EXPORT" {
        return Err(super::fail("Cancelled."));
    }

    println!();
    println!("{}", colors::green("✅ Key exported:"));
    println!();
    println!("{}", colors::cyan("Public Key:"));
    println!("{}", key.public_key);
    println!();
    println!("{}", colors::cyan("Private Key:"));
    println!("{}", key.private_key);
    println!();
    println!(
        "{}",
        colors::yellow("⚠️  Store your private key securely. Never share it with anyone.")
    );
    Ok(())
}

pub async fn revoke_key(
    account: Option<&str>,
    network: Network,
    force: bool,
) -> Result<(), AppError> {
    let (acc_id, key_pair, client) = create_authenticated_client(account, network).await?;

    let orderly_key = format!(
        "ed25519:{}",
        crypto::get_public_key_base58(&key_pair.public_key)
    );

    let non_interactive = !is_tty();

    if non_interactive {
        if !force {
            return Err(super::fail_hints(
                "--force is required in non-interactive mode.",
                vec![
                    "Example: orderly wallet-revoke-key --account <id> --force".to_string(),
                    "WARNING: This permanently deactivates the key on the server and removes it from the keychain.".to_string(),
                ],
            ));
        }
    } else {
        println!("{}", colors::cyan("\n🗑️  Revoke Orderly Key\n"));
        println!(
            "{}",
            colors::yellow("⚠️  WARNING: This will permanently revoke the API key.")
        );
        println!(
            "{}",
            colors::yellow("   You will lose ALL access to this account via this key.")
        );
        println!("{}", colors::dim(&format!("   Account: {acc_id}")));
        println!("{}", colors::dim(&format!("   Key: {orderly_key}")));
        println!();

        let confirm = super::prompt::input(
            "Type \"REVOKE\" to confirm you want to permanently revoke this key:",
        )?;
        if confirm != "REVOKE" {
            return Err(super::fail("Cancelled."));
        }
    }

    let result = client.remove_orderly_key(&orderly_key).await?;
    if result.get("success").and_then(|s| s.as_bool()) == Some(true) {
        if keychain::delete_key(&acc_id, network.as_str())
            .await
            .is_err()
            && !non_interactive
        {
            println!(
                "{}",
                colors::yellow("Key revoked on server but failed to remove from local keychain.")
            );
        }
        if non_interactive {
            output(
                &obj(vec![
                    ("success", Value::Bool(true)),
                    ("revoked", Value::String(orderly_key)),
                    ("account", Value::String(acc_id)),
                    ("network", Value::String(network.as_str().to_string())),
                ]),
                crate::output::OutputFormat::Json,
            );
        } else {
            println!();
            println!("{}", colors::green("✅ Key revoked successfully."));
            println!("{}", colors::dim(&format!("   Account: {acc_id}")));
            println!("{}", colors::dim(&format!("   Key: {orderly_key}")));
            println!();
            println!(
                "{}",
                colors::dim(
                    "The key has been deactivated on the server and removed from local keychain."
                )
            );
            println!(
                "{}",
                colors::dim("Run `orderly wallet-add-key` to generate a new key if needed.")
            );
        }
    } else {
        return Err(super::fail("Failed to revoke key on server."));
    }
    Ok(())
}
