//! `src/commands/wallet.ts`

use crate::account_select::is_tty;
use crate::api::{obj, OrderlyClient};
use crate::cli::Ctx;
use crate::colors;
use crate::config::set_default_network;
use crate::crypto;
use crate::error::AppError;
use crate::keychain::{self, KeyPair, WalletKeyPair};
use crate::output::output;
use crate::types::{Network, WalletType};
use crate::{evm, solana};
use serde_json::Value;

const VALID_WALLET_TYPES: [&str; 2] = ["EVM", "SOL"];
const VALID_SCOPES: [&str; 3] = ["read", "trading", "asset"];

fn resolve_wallet_type(wallet_type: Option<&str>) -> Result<Option<WalletType>, AppError> {
    let Some(raw) = wallet_type.filter(|t| !t.is_empty()) else {
        return Ok(None);
    };
    let upper = raw.to_uppercase();
    if !VALID_WALLET_TYPES.contains(&upper.as_str()) {
        return Err(super::fail(format!(
            "Invalid wallet type: \"{raw}\". Valid types: {}",
            VALID_WALLET_TYPES.join(", ")
        )));
    }
    Ok(WalletType::parse(&upper))
}

fn prompt_wallet_type() -> Result<WalletType, AppError> {
    let items = vec![
        "EVM (Ethereum, Arbitrum, etc.)".to_string(),
        "SOL".to_string(),
    ];
    let idx = super::prompt::select("Select wallet type", &items)?;
    Ok(if idx == 0 {
        WalletType::Evm
    } else {
        WalletType::Sol
    })
}

fn chain_id_for(wallet_type: &WalletType, network: Network) -> u64 {
    match wallet_type {
        WalletType::Sol => solana::get_solana_chain_id(network),
        WalletType::Evm => {
            if network == Network::Mainnet {
                42161
            } else {
                421614
            }
        }
    }
}

/// Shared "select a stored wallet" prompt for the interactive paths.
async fn select_wallet(network: Network, message: &str) -> Result<String, AppError> {
    let wallets = keychain::list_wallet_keys().await.map_err(AppError::Msg)?;
    let filtered: Vec<keychain::StoredWalletKey> = wallets
        .into_iter()
        .filter(|w| w.network == network.as_str())
        .collect();

    if filtered.is_empty() {
        return Err(super::fail(format!(
            "No wallets found for {network}. Import a wallet first."
        )));
    }

    let items: Vec<String> = filtered
        .iter()
        .map(|w| format!("{} ({})", w.address, w.wallet_type))
        .collect();
    let idx = super::prompt::select(message, &items)?;
    Ok(filtered[idx].address.clone())
}

pub async fn wallet_create(wallet_type: Option<&str>, network: Network) -> Result<(), AppError> {
    let non_interactive = wallet_type.filter(|t| !t.is_empty()).is_some();

    if !non_interactive {
        println!(
            "{}",
            colors::cyan(&format!("\n🔐 Create New Wallet ({network})\n"))
        );
    }

    let mut resolved = resolve_wallet_type(wallet_type)?;
    if resolved.is_none() {
        if !is_tty() {
            return Err(super::fail_hints(
                "--type is required in non-interactive mode.",
                vec![
                    "Example: orderly wallet-create --type EVM".to_string(),
                    "Valid types: EVM, SOL".to_string(),
                ],
            ));
        }
        resolved = Some(prompt_wallet_type()?);
    }
    let type_ = resolved.expect("wallet type resolved");

    let (address, private_key) = match type_ {
        WalletType::Evm => {
            let wallet = evm::EvmWallet::generate();
            (wallet.address.clone(), wallet.private_key_hex())
        }
        WalletType::Sol => {
            let wallet = solana::generate_solana_wallet();
            (wallet.address.clone(), wallet.private_key.clone())
        }
    };

    let wallet_key_pair = WalletKeyPair {
        address: address.clone(),
        private_key,
        wallet_type: type_.as_str().to_string(),
        network: network.as_str().to_string(),
    };

    keychain::store_wallet_key(&address, network.as_str(), &wallet_key_pair)
        .await
        .map_err(|_| super::fail("Failed to store wallet"))?;

    if non_interactive {
        output(
            &obj(vec![
                ("address", Value::String(address.clone())),
                ("type", Value::String(type_.as_str().to_string())),
                ("network", Value::String(network.as_str().to_string())),
            ]),
            crate::output::OutputFormat::Json,
        );
    } else {
        println!();
        println!("{}", colors::green("✅ Wallet created successfully!"));
        println!("{}", colors::dim(&format!("Address: {address}")));
        println!("{}", colors::dim(&format!("Type: {type_}")));
        println!("{}", colors::dim(&format!("Network: {network}")));
        println!();
        println!(
            "{}",
            colors::yellow(
                "⚠️  Private key is stored in OS keychain and will never be shown again."
            )
        );
        println!(
            "{}",
            colors::dim("Make sure to back up your wallet if needed for external use.")
        );
    }
    Ok(())
}

pub async fn wallet_import(
    wallet_type: Option<&str>,
    address: Option<&str>,
    private_key: Option<&str>,
    network: Network,
) -> Result<(), AppError> {
    println!(
        "{}",
        colors::cyan(&format!("\n🔑 Import Wallet ({network})\n"))
    );

    let mut resolved = resolve_wallet_type(wallet_type)?;
    if resolved.is_none() {
        if !is_tty() {
            return Err(super::fail_hints(
                "--type is required in non-interactive mode.",
                vec![
                    "Example: orderly wallet-import --type EVM".to_string(),
                    "Valid types: EVM, SOL".to_string(),
                ],
            ));
        }
        resolved = Some(prompt_wallet_type()?);
    }
    let type_ = resolved.expect("wallet type resolved");

    let mut addr = address.filter(|a| !a.is_empty()).map(String::from);
    let mut key = private_key.filter(|k| !k.is_empty()).map(String::from);

    if key.is_none() {
        if !is_tty() {
            return Err(super::fail_hints(
                "Private key is required in non-interactive mode.",
                vec!["Example: orderly wallet-import <private-key> --type EVM".to_string()],
            ));
        }
        let value = super::prompt::password(&format!("Enter your {type_} private key"))?;
        if value.is_empty() {
            return Err(super::fail("Cancelled."));
        }
        key = Some(value.trim().to_string());
    }
    let key = key.expect("private key resolved");

    let wallet_address = match type_ {
        WalletType::Evm => {
            let wallet = evm::EvmWallet::from_private_key(&evm::normalize_private_key(&key))
                .map_err(|e| super::fail(format!("Invalid private key: {e}")))?;
            wallet.address
        }
        WalletType::Sol => {
            let wallet = solana::create_solana_wallet_from_private_key(&key, network)
                .map_err(|e| super::fail(format!("Invalid private key: {e}")))?;
            wallet.address
        }
    };

    if let Some(given) = &addr {
        if given.to_lowercase() != wallet_address.to_lowercase() {
            return Err(super::fail("Provided address does not match private key"));
        }
    }
    addr = Some(wallet_address.clone());
    let address = addr.expect("address resolved");

    let existing = keychain::has_wallet_key(&address, network.as_str()).await;
    if existing {
        if !is_tty() {
            return Err(super::fail(format!(
                "Wallet already exists for {address} on {network}. Use wallet-remove first to remove it."
            )));
        }
        println!(
            "{}",
            colors::yellow(&format!("Wallet already exists for {address} on {network}"))
        );
        if !super::prompt::confirm("Overwrite existing wallet?", false)? {
            return Err(super::fail("Cancelled."));
        }
    }

    let wallet_key_pair = WalletKeyPair {
        address: address.clone(),
        private_key: key,
        wallet_type: type_.as_str().to_string(),
        network: network.as_str().to_string(),
    };

    keychain::store_wallet_key(&address, network.as_str(), &wallet_key_pair)
        .await
        .map_err(|_| super::fail("Failed to store wallet"))?;

    println!();
    println!("{}", colors::green("✅ Wallet imported successfully!"));
    println!("{}", colors::dim(&format!("Address: {address}")));
    println!("{}", colors::dim(&format!("Type: {type_}")));
    Ok(())
}

pub async fn wallet_list(network: Network, ctx: Ctx) -> Result<(), AppError> {
    let wallets = keychain::list_wallet_keys().await.map_err(AppError::Msg)?;
    let filtered: Vec<keychain::StoredWalletKey> = wallets
        .into_iter()
        .filter(|w| w.network == network.as_str())
        .collect();

    if filtered.is_empty() {
        if ctx.is_csv() {
            return Ok(());
        }
        println!(
            "{}",
            colors::yellow("No wallets stored. Run `orderly wallet-import` to get started.")
        );
        return Ok(());
    }

    let result: Vec<Value> = filtered
        .iter()
        .map(|wallet| {
            obj(vec![
                ("address", Value::String(wallet.address.clone())),
                ("network", Value::String(wallet.network.clone())),
                ("walletType", Value::String(wallet.wallet_type.clone())),
            ])
        })
        .collect();

    output(&Value::Array(result), ctx.format);
    Ok(())
}

pub async fn wallet_show(
    address: Option<&str>,
    network: Network,
    ctx: Ctx,
) -> Result<(), AppError> {
    let mut addr = address.filter(|a| !a.is_empty()).map(String::from);

    if addr.is_none() {
        if !is_tty() {
            return Err(super::fail_hints(
                "Address is required in non-interactive mode.",
                vec![
                    "Example: orderly wallet-show \"0x1234...\"".to_string(),
                    "Run `orderly wallet-list` to see available addresses.".to_string(),
                ],
            ));
        }
        addr = Some(select_wallet(network, "Select wallet").await?);
    }

    let Some(addr) = addr else {
        return Err(super::fail("No address specified."));
    };

    let Some(wallet) = keychain::get_wallet_key(&addr, network.as_str())
        .await
        .map_err(AppError::Msg)?
    else {
        return Err(super::fail(format!(
            "No wallet found for {addr} on {network}"
        )));
    };

    let all_keys = keychain::list_keys().await.map_err(AppError::Msg)?;
    let matching: Vec<keychain::StoredKey> = all_keys
        .into_iter()
        .filter(|k| {
            if k.network != network.as_str() {
                return false;
            }
            let Some(k_address) = &k.address else {
                return false;
            };
            let k_addr = k_address.to_lowercase();
            let w_addr = wallet.address.to_lowercase();
            k_addr == w_addr || k_addr == format!("0x{w_addr}") || format!("0x{k_addr}") == w_addr
        })
        .collect();

    let client = OrderlyClient::new(network);
    let mut accounts: Vec<Value> = Vec::new();
    for key in &matching {
        let broker_id = client.get_broker_id(&key.account_id).await.ok();
        let mut pairs = vec![("accountId", Value::String(key.account_id.clone()))];
        if let Some(broker_id) = broker_id {
            pairs.push(("brokerId", Value::String(broker_id)));
        }
        accounts.push(obj(pairs));
    }

    output(
        &obj(vec![
            ("address", Value::String(wallet.address.clone())),
            ("network", Value::String(wallet.network.clone())),
            ("walletType", Value::String(wallet.wallet_type.clone())),
            ("accounts", Value::Array(accounts)),
        ]),
        ctx.format,
    );
    Ok(())
}

pub async fn wallet_remove(
    address: Option<&str>,
    network: Network,
    force: bool,
    ctx: Ctx,
) -> Result<(), AppError> {
    println!("{}", colors::cyan("\n🗑️  Remove Wallet\n"));

    let mut addr = address.filter(|a| !a.is_empty()).map(String::from);

    if addr.is_none() {
        if !is_tty() {
            return Err(super::fail_hints(
                "Address is required in non-interactive mode.",
                vec![
                    "Example: orderly wallet-remove \"0x1234...\"".to_string(),
                    "Run `orderly wallet-list` to see available addresses.".to_string(),
                ],
            ));
        }
        let wallets = keychain::list_wallet_keys().await.map_err(AppError::Msg)?;
        let filtered: Vec<keychain::StoredWalletKey> = wallets
            .into_iter()
            .filter(|w| w.network == network.as_str())
            .collect();
        if filtered.is_empty() {
            println!(
                "{}",
                colors::yellow(&format!("No wallets stored for {network}."))
            );
            return Ok(());
        }
        let items: Vec<String> = filtered
            .iter()
            .map(|w| format!("{} ({})", w.address, w.wallet_type))
            .collect();
        let idx = super::prompt::select("Select wallet to remove", &items)?;
        addr = Some(filtered[idx].address.clone());
    }

    let Some(addr) = addr else {
        return Err(super::fail("No address selected."));
    };

    println!(
        "{}",
        colors::yellow("⚠️  WARNING: Removing a wallet deletes its private key from the keychain.")
    );
    println!(
        "{}",
        colors::yellow(
            "   This can cause PERMANENT LOSS OF ACCESS to any accounts that depend on it."
        )
    );
    println!("{}", colors::dim(&format!("   Address: {addr}")));
    println!("{}", colors::dim(&format!("   Network: {network}")));
    println!();

    if !is_tty() {
        if !force {
            return Err(super::fail_hints(
                "--force is required in non-interactive mode.",
                vec![
                    "Example: orderly wallet-remove \"0x1234...\" --force".to_string(),
                    "WARNING: This permanently deletes the wallet private key from the OS keychain."
                        .to_string(),
                ],
            ));
        }
        let deleted = keychain::delete_wallet_key(&addr, network.as_str())
            .await
            .map_err(|_| super::fail("Failed to remove wallet"))?;
        if deleted {
            output(
                &obj(vec![
                    ("removed", Value::Bool(true)),
                    ("address", Value::String(addr)),
                    ("network", Value::String(network.as_str().to_string())),
                ]),
                ctx.format,
            );
        } else {
            return Err(super::fail(format!(
                "No wallet found for {addr} on {network}"
            )));
        }
        return Ok(());
    }

    if !force {
        let confirm = super::prompt::input("Type the wallet address to confirm removal:")?;
        if confirm.to_lowercase() != addr.to_lowercase() {
            return Err(super::fail("Cancelled."));
        }
    }

    let deleted = keychain::delete_wallet_key(&addr, network.as_str())
        .await
        .map_err(|_| super::fail("Failed to remove wallet"))?;
    if deleted {
        println!(
            "{}",
            colors::green(&format!("Wallet removed for {addr} on {network}"))
        );
    } else {
        println!(
            "{}",
            colors::yellow(&format!("No wallet found for {addr} on {network}"))
        );
    }
    Ok(())
}

pub async fn wallet_logout(
    address: Option<&str>,
    network: Network,
    ctx: Ctx,
) -> Result<(), AppError> {
    wallet_remove(address, network, false, ctx).await
}

pub async fn wallet_register(
    broker_id: Option<&str>,
    address: Option<&str>,
    network: Network,
) -> Result<(), AppError> {
    let broker_id = broker_id.filter(|b| !b.is_empty());
    let address = address.filter(|a| !a.is_empty());
    let non_interactive = broker_id.is_some() && address.is_some();

    if !non_interactive && !is_tty() {
        return Err(super::fail_hints(
            "--broker-id and --address are required in non-interactive mode.",
            vec![
                "Example: orderly wallet-register --broker-id demo --address \"0x1234...\""
                    .to_string(),
            ],
        ));
    }

    if !non_interactive {
        println!(
            "{}",
            colors::cyan(&format!("\n📝 Register Account ({network})\n"))
        );
    }

    let b_id = match broker_id {
        Some(b) => b.to_string(),
        None => {
            let value = super::prompt::input("Enter your Broker ID")?;
            if value.is_empty() {
                return Err(super::fail("Cancelled."));
            }
            value.trim().to_string()
        }
    };

    let addr = match address {
        Some(a) => a.to_string(),
        None => select_wallet(network, "Select wallet to register").await?,
    };

    let Some(wallet_key) = keychain::get_wallet_key(&addr, network.as_str())
        .await
        .map_err(AppError::Msg)?
    else {
        return Err(super::fail(format!(
            "No wallet found for {addr} on {network}"
        )));
    };

    let client = OrderlyClient::new(network);

    if let Ok(existing) = client
        .get_account(&addr, &b_id, Some(&wallet_key.wallet_type))
        .await
    {
        if existing.get("success").and_then(|s| s.as_bool()) == Some(true) {
            if let Some(account_id) = existing
                .get("data")
                .and_then(|d| d.get("account_id"))
                .and_then(|a| a.as_str())
            {
                if non_interactive {
                    output(
                        &obj(vec![
                            ("accountId", Value::String(account_id.to_string())),
                            ("address", Value::String(addr.clone())),
                            ("network", Value::String(network.as_str().to_string())),
                            ("alreadyExists", Value::Bool(true)),
                        ]),
                        crate::output::OutputFormat::Json,
                    );
                } else {
                    println!(
                        "{}",
                        colors::yellow(&format!("Account already exists: {account_id}"))
                    );
                    println!(
                        "{}",
                        colors::dim(
                            "Use `orderly wallet-add-key` to add an API key to this account."
                        )
                    );
                }
                return Ok(());
            }
        }
    }

    let nonce_response = client.get_registration_nonce().await?;
    let nonce = nonce_response
        .get("data")
        .and_then(|d| d.get("registration_nonce"))
        .filter(|v| !v.is_null())
        .map(crate::commands::settle::stringify_number);
    let Some(nonce) = nonce else {
        return Err(super::fail("Failed to get registration nonce"));
    };

    let timestamp = super::now_ms();
    let chain_id = chain_id_for(
        &WalletType::parse(&wallet_key.wallet_type).unwrap_or(WalletType::Evm),
        network,
    );

    let (message, signature) = if wallet_key.wallet_type == "SOL" {
        let wallet =
            solana::create_solana_wallet_from_private_key(&wallet_key.private_key, network)
                .map_err(|_| super::fail("Failed to sign message"))?;
        solana::sign_registration(&wallet, &b_id, timestamp, &nonce, network)
    } else {
        let wallet =
            evm::EvmWallet::from_private_key(&evm::normalize_private_key(&wallet_key.private_key))
                .map_err(|_| super::fail("Failed to sign message"))?;
        let message = obj(vec![
            ("brokerId", Value::String(b_id.clone())),
            ("chainId", Value::from(chain_id)),
            ("timestamp", Value::String(timestamp.to_string())),
            ("registrationNonce", Value::String(nonce.clone())),
        ]);
        let signature = evm::sign_registration(&wallet, &message);
        (message, signature)
    };

    let result = client
        .register_account(&message, &signature, &addr, Some(&wallet_key.wallet_type))
        .await?;

    if result.get("success").and_then(|s| s.as_bool()) == Some(true) {
        if let Some(account_id) = result
            .get("data")
            .and_then(|d| d.get("account_id"))
            .and_then(|a| a.as_str())
        {
            if non_interactive {
                output(
                    &obj(vec![
                        ("accountId", Value::String(account_id.to_string())),
                        ("address", Value::String(addr.clone())),
                        ("network", Value::String(network.as_str().to_string())),
                    ]),
                    crate::output::OutputFormat::Json,
                );
            } else {
                println!();
                println!("{}", colors::cyan("Account ID:"));
                println!("{account_id}");
                println!();
                println!(
                    "{}",
                    colors::dim(
                        "Next step: Use `orderly wallet-add-key` to add an API key for trading."
                    )
                );
            }
            return Ok(());
        }
    }

    let api_msg = result
        .get("message")
        .and_then(|m| m.as_str())
        .map(String::from);
    Err(super::fail_hints(
        "Failed to register account",
        api_msg.into_iter().collect(),
    ))
}

fn normalize_scope(scope: &str) -> Result<String, AppError> {
    let normalized = scope.to_lowercase();
    let parts: Vec<String> = normalized
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let invalid: Vec<String> = parts
        .iter()
        .filter(|s| !VALID_SCOPES.contains(&s.as_str()))
        .cloned()
        .collect();
    if !invalid.is_empty() {
        return Err(super::fail_hints(
            format!("Invalid scope value(s): {}", invalid.join(", ")),
            vec![
                format!("Valid scopes: {}", VALID_SCOPES.join(", ")),
                format!("Example: --scope {}", VALID_SCOPES.join(",")),
            ],
        ));
    }
    Ok(parts.join(","))
}

pub async fn wallet_add_key(
    address: Option<&str>,
    scope: Option<&str>,
    network: Network,
    broker_id: Option<&str>,
) -> Result<(), AppError> {
    let address = address.filter(|a| !a.is_empty());
    let broker_id = broker_id.filter(|b| !b.is_empty());
    let non_interactive = address.is_some();

    if !non_interactive && !is_tty() {
        let mut hints = vec!["Example: orderly wallet-add-key --address \"0x1234...\"".to_string()];
        if broker_id.is_none() {
            hints.push("Add --broker-id <id> to skip broker ID lookup.".to_string());
        }
        return Err(super::fail_hints(
            "--address is required in non-interactive mode.",
            hints,
        ));
    }

    if !non_interactive {
        println!(
            "{}",
            colors::cyan(&format!("\n🔐 Add Orderly API Key ({network})\n"))
        );
    }

    let addr = match address {
        Some(a) => a.to_string(),
        None => select_wallet(network, "Select wallet to add key for").await?,
    };

    let Some(wallet_key) = keychain::get_wallet_key(&addr, network.as_str())
        .await
        .map_err(AppError::Msg)?
    else {
        return Err(super::fail(format!(
            "No wallet found for {addr} on {network}"
        )));
    };

    let client = OrderlyClient::new(network);

    let (account_id, resolved_broker_id) = if let Some(b_id) = broker_id {
        let b_id = b_id.trim().to_string();
        let account_info = client
            .get_account(&addr, &b_id, Some(&wallet_key.wallet_type))
            .await?;
        let account_id = account_info
            .get("data")
            .and_then(|d| d.get("account_id"))
            .and_then(|a| a.as_str())
            .map(String::from);
        if account_info.get("success").and_then(|s| s.as_bool()) != Some(true)
            || account_id.is_none()
        {
            return Err(super::fail(
                "Account not found. Run `orderly wallet-register` first.",
            ));
        }
        (account_id.unwrap(), b_id)
    } else {
        let stored_keys = keychain::list_keys().await.map_err(AppError::Msg)?;
        let matching = stored_keys
            .into_iter()
            .find(|k| k.address.as_deref() == Some(addr.as_str()) && k.network == network.as_str());
        if let Some(key) = matching {
            let account_id = key.account_id.clone();
            let resolved = client.get_broker_id(&account_id).await.map_err(|_| {
                super::fail("Failed to resolve broker_id for account. Register the account first.")
            })?;
            (account_id, resolved)
        } else {
            if !is_tty() {
                return Err(super::fail_hints(
                    "--broker-id is required when no API key is stored for this wallet.",
                    vec![
                        "Example: orderly wallet-add-key --address \"0x1234...\" --broker-id demo"
                            .to_string(),
                    ],
                ));
            }
            let value = super::prompt::input("Enter your Broker ID")?;
            if value.is_empty() {
                return Err(super::fail("Cancelled."));
            }
            let b_id = value.trim().to_string();
            let account_info = client
                .get_account(&addr, &b_id, Some(&wallet_key.wallet_type))
                .await?;
            let account_id = account_info
                .get("data")
                .and_then(|d| d.get("account_id"))
                .and_then(|a| a.as_str())
                .map(String::from);
            if account_info.get("success").and_then(|s| s.as_bool()) != Some(true)
                || account_id.is_none()
            {
                return Err(super::fail(
                    "Account not found. Run `orderly wallet-register` first.",
                ));
            }
            (account_id.unwrap(), b_id)
        }
    };

    let mut key_scope = match scope.filter(|s| !s.is_empty()) {
        Some(s) => Some(normalize_scope(s)?),
        None => None,
    };
    if key_scope.is_none() && !is_tty() {
        key_scope = Some("read,trading".to_string());
    }
    if key_scope.is_none() {
        let items = vec![
            "read".to_string(),
            "trading".to_string(),
            "asset".to_string(),
        ];
        let defaults = vec![true, true, false];
        let selected = dialoguer::MultiSelect::new()
            .with_prompt("Select key scopes")
            .items(&items)
            .defaults(&defaults)
            .interact()
            .map_err(|e| super::fail(format!("Prompt failed: {e}")))?;
        if selected.is_empty() {
            return Err(super::fail("Cancelled."));
        }
        key_scope = Some(
            selected
                .iter()
                .map(|i| items[*i].clone())
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    let Some(key_scope) = key_scope else {
        return Err(super::fail("Key scope is required."));
    };

    let ed25519_key_pair = crypto::generate_key_pair();
    let orderly_key = format!(
        "ed25519:{}",
        crypto::get_public_key_base58(&ed25519_key_pair.public_key)
    );

    let timestamp = super::now_ms();
    let expiration = timestamp + 365 * 24 * 60 * 60 * 1000;
    let wallet_type = WalletType::parse(&wallet_key.wallet_type).unwrap_or(WalletType::Evm);
    let chain_id = chain_id_for(&wallet_type, network);

    let (message, signature) = if wallet_key.wallet_type == "SOL" {
        let wallet =
            solana::create_solana_wallet_from_private_key(&wallet_key.private_key, network)
                .map_err(|_| super::fail("Failed to sign message"))?;
        solana::sign_add_key(
            &wallet,
            &resolved_broker_id,
            &orderly_key,
            &key_scope,
            timestamp,
            expiration,
            network,
        )
    } else {
        let wallet =
            evm::EvmWallet::from_private_key(&evm::normalize_private_key(&wallet_key.private_key))
                .map_err(|_| super::fail("Failed to sign message"))?;
        let message = obj(vec![
            ("brokerId", Value::String(resolved_broker_id.clone())),
            ("chainId", Value::from(chain_id)),
            ("orderlyKey", Value::String(orderly_key.clone())),
            ("scope", Value::String(key_scope.clone())),
            ("timestamp", Value::from(timestamp)),
            ("expiration", Value::from(expiration)),
        ]);
        let signature = evm::sign_add_key(&wallet, &message);
        (message, signature)
    };

    let chain_type = if wallet_key.wallet_type == "SOL" {
        Some("SOL")
    } else {
        None
    };
    let result = client
        .add_orderly_key(&message, &signature, &addr, chain_type)
        .await?;

    #[allow(clippy::collapsible_if)]
    if result.get("success").and_then(|s| s.as_bool()) == Some(true) {
        if result
            .get("data")
            .and_then(|d| d.get("orderly_key"))
            .is_some_and(|k| !k.is_null())
        {
            let key_pair = KeyPair {
                account_id: account_id.clone(),
                address: Some(addr.clone()),
                wallet_type: Some(wallet_key.wallet_type.clone()),
                public_key: ed25519_key_pair.public_key,
                private_key: ed25519_key_pair.private_key,
                network: network.as_str().to_string(),
            };

            keychain::store_key(&account_id, network.as_str(), &key_pair)
                .await
                .map_err(|e| super::fail(format!("Failed to store key: {e}")))?;
            set_default_network(network);

            if non_interactive {
                output(
                    &obj(vec![
                        ("accountId", Value::String(account_id.clone())),
                        ("address", Value::String(addr.clone())),
                        ("orderlyKey", Value::String(orderly_key.clone())),
                        ("network", Value::String(network.as_str().to_string())),
                    ]),
                    crate::output::OutputFormat::Json,
                );
            } else {
                println!();
                println!("{}", colors::green("✅ Setup complete!"));
                println!("{}", colors::dim(&format!("Account ID: {account_id}")));
                println!("{}", colors::dim(&format!("Orderly Key: {orderly_key}")));
                println!();
                println!("{}", colors::dim("You can now use trading commands like:"));
                println!(
                    "{}",
                    colors::cyan(&format!("  orderly account-info --account {account_id}"))
                );
                println!(
                    "{}",
                    colors::cyan(&format!(
                        "  orderly order-place PERP_ETH_USDC BUY MARKET 0.01 --account {account_id}"
                    ))
                );
            }
            return Ok(());
        }
    }

    let api_msg = result.get("message").and_then(|m| m.as_str());
    let hint = match api_msg {
        Some(msg) => format!("API response: {msg}"),
        None => format!(
            "Request succeeded but no orderly_key was returned. Scopes requested: {key_scope}"
        ),
    };
    Err(super::fail_hints("Failed to add Orderly key", vec![hint]))
}
