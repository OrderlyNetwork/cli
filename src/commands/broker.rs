//! `src/commands/broker.ts`

use crate::account_select::is_tty;
use crate::api::{obj, OrderlyClient};
use crate::cli::{BrokerCreateArgs, Ctx};
use crate::colors;
use crate::dex_api::DexApiClient;
use crate::error::AppError;
use crate::evm;
use crate::keychain::{self, get_wallet_key};
use crate::output::output;
use crate::types::Network;
use serde_json::Value;

const BROKER_ID_REGEX: &str = r"^[a-z0-9_-]+$";

/// (key, name, chain id)
const SUPPORTED_CHAINS: [(&str, &str, i64); 3] = [
    ("ethereum", "Ethereum", 1),
    ("arbitrum", "Arbitrum", 42161),
    ("base", "Base", 8453),
];

const TESTNET_CHAINS: [(&str, &str, i64); 3] = [
    ("sepolia", "Sepolia", 11155111),
    ("arbitrum-sepolia", "Arbitrum Sepolia", 421614),
    ("base-sepolia", "Base Sepolia", 84532),
];

fn chains_for(network: Network) -> &'static [(&'static str, &'static str, i64)] {
    match network {
        Network::Mainnet => &SUPPORTED_CHAINS,
        Network::Testnet => &TESTNET_CHAINS,
    }
}

fn validate_broker_id(id: &str) -> Result<(), String> {
    if id.len() < 5 {
        return Err("Broker ID must be at least 5 characters".to_string());
    }
    if id.len() > 15 {
        return Err("Broker ID must be at most 15 characters".to_string());
    }
    if !regex::Regex::new(BROKER_ID_REGEX)
        .map(|re| re.is_match(id))
        .unwrap_or(false)
    {
        return Err(
            "Broker ID can only contain lowercase letters, numbers, hyphens, and underscores"
                .to_string(),
        );
    }
    if id.contains("orderly") {
        return Err("Broker ID cannot contain \"orderly\"".to_string());
    }
    Ok(())
}

async fn fetch_existing_broker_ids(network: Network) -> Vec<String> {
    let client = OrderlyClient::new(network);
    let Ok(result) = client.get_public("/v1/public/broker/name").await else {
        return Vec::new();
    };
    result
        .get("data")
        .and_then(|d| d.get("rows"))
        .and_then(|r| r.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(|r| {
                    r.get("broker_id")
                        .and_then(|b| b.as_str())
                        .map(String::from)
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn select_evm_wallet(network: Network) -> Result<String, AppError> {
    let wallets = keychain::list_wallet_keys().await.map_err(AppError::Msg)?;
    let evm_wallets: Vec<keychain::StoredWalletKey> = wallets
        .into_iter()
        .filter(|w| w.network == network.as_str() && w.wallet_type == "EVM")
        .collect();

    if evm_wallets.is_empty() {
        return Err(super::fail(
            "No EVM wallets found. Import one first with `orderly wallet-import --type EVM`.",
        ));
    }
    if evm_wallets.len() == 1 {
        return Ok(evm_wallets[0].address.clone());
    }

    let items: Vec<String> = evm_wallets
        .iter()
        .map(|w| format!("{} ({})", w.address, w.wallet_type))
        .collect();
    let idx = super::prompt::select("Select EVM wallet to authenticate with", &items)?;
    Ok(evm_wallets[idx].address.clone())
}

async fn register_and_finalize(
    wallet_address: &str,
    broker_id: &str,
    dex_client: &DexApiClient,
    orderly_client: &OrderlyClient,
    network: Network,
) -> Result<(), AppError> {
    let chain_id: u64 = if network == Network::Mainnet {
        42161
    } else {
        421614
    };

    let existing = orderly_client
        .get_account(wallet_address, broker_id, Some("EVM"))
        .await?;
    let already_registered = existing.get("success").and_then(|s| s.as_bool()) == Some(true)
        && existing
            .get("data")
            .and_then(|d| d.get("account_id"))
            .is_some();

    if !already_registered {
        println!("{}", colors::dim("Registering wallet with Orderly..."));

        let nonce_res = orderly_client.get_registration_nonce().await?;
        let nonce = nonce_res
            .get("data")
            .and_then(|d| d.get("registration_nonce"))
            .filter(|v| !v.is_null())
            .map(crate::commands::settle::stringify_number);
        let Some(nonce) = nonce else {
            return Err(super::fail("Failed to get registration nonce"));
        };
        let timestamp = super::now_ms();

        let wallet_key = get_wallet_key(wallet_address, network.as_str())
            .await
            .map_err(AppError::Msg)?
            .ok_or_else(|| super::fail("Wallet key not found"))?;
        let evm_wallet =
            evm::EvmWallet::from_private_key(&evm::normalize_private_key(&wallet_key.private_key))
                .map_err(AppError::Msg)?;

        let message = obj(vec![
            ("brokerId", Value::String(broker_id.to_string())),
            ("chainId", Value::from(chain_id)),
            ("timestamp", Value::String(timestamp.to_string())),
            ("registrationNonce", Value::String(nonce.clone())),
        ]);
        let signature = evm::sign_registration(&evm_wallet, &message);

        let register_res = orderly_client
            .register_account(&message, &signature, wallet_address, None)
            .await?;
        let account_id = register_res
            .get("data")
            .and_then(|d| d.get("account_id"))
            .and_then(|a| a.as_str());
        if register_res.get("success").and_then(|s| s.as_bool()) != Some(true)
            || account_id.is_none()
        {
            return Err(super::fail("Failed to register account with Orderly"));
        }
        println!(
            "{}",
            colors::dim(&format!("  Account ID: {}", account_id.unwrap()))
        );
    }

    println!("{}", colors::dim("Finalizing admin wallet..."));
    let finalize_res = dex_client.finalize_admin_wallet().await?;
    if finalize_res.get("success").and_then(|s| s.as_bool()) == Some(true) {
        println!(
            "{}",
            colors::green("✅ Admin wallet finalized. DEX is now graduated!")
        );
    } else {
        let message = finalize_res
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("");
        println!(
            "{}",
            colors::yellow(&format!("⚠️  Finalization returned: {message}"))
        );
    }
    Ok(())
}

fn fee_range_error(value: f64, min: f64, max: f64, label: &str) -> Option<String> {
    if value < min || value > max {
        return Some(format!(
            "{label} must be between {} and {} (got {})",
            crate::output::js_f64_to_string(min),
            crate::output::js_f64_to_string(max),
            crate::output::js_f64_to_string(value)
        ));
    }
    None
}

fn validate_fee(value: &str, min: f64, max: f64, label: &str) -> Result<(), String> {
    let num: f64 = value
        .parse()
        .map_err(|_| format!("{label} must be a number"))?;
    if num < min || num > max {
        return Err(format!(
            "{label} must be between {} and {}",
            crate::output::js_f64_to_string(min),
            crate::output::js_f64_to_string(max)
        ));
    }
    let decimals = value
        .split_once('.')
        .map(|(_, frac)| frac.len())
        .unwrap_or(0);
    if decimals > 1 {
        return Err(format!("{label} must be in 0.1 bps increments"));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn verify_tx_payload(
    tx_hash: &str,
    chain: &str,
    chain_id: i64,
    broker_id: &str,
    maker_fee: f64,
    taker_fee: f64,
    rwa_maker_fee: f64,
    rwa_taker_fee: f64,
    payment_type: &str,
) -> Value {
    obj(vec![
        ("txHash", Value::String(tx_hash.to_string())),
        ("chain", Value::String(chain.to_string())),
        ("chainId", crate::api::js_number(chain_id as f64)),
        ("chain_type", Value::String("EVM".to_string())),
        ("brokerId", Value::String(broker_id.to_string())),
        ("makerFee", crate::api::js_number(maker_fee)),
        ("takerFee", crate::api::js_number(taker_fee)),
        ("rwaMakerFee", crate::api::js_number(rwa_maker_fee)),
        ("rwaTakerFee", crate::api::js_number(rwa_taker_fee)),
        ("paymentType", Value::String(payment_type.to_string())),
    ])
}

pub async fn broker_create(args: &BrokerCreateArgs, ctx: Ctx) -> Result<(), AppError> {
    let network = ctx.network;
    let is_direct = args.tx_hash.is_some();

    if !is_direct {
        println!(
            "{}",
            colors::cyan(&format!("\n🏗️  Create Broker ID ({network})\n"))
        );
    }

    let wallet_address = match args.address.as_deref().filter(|a| !a.is_empty()) {
        Some(a) => a.to_string(),
        None => {
            if !is_tty() {
                return Err(super::fail_hints(
                    "--address is required in non-interactive mode.",
                    vec![
                        "Example: orderly broker-create my-broker --address 0x1234...".to_string(),
                    ],
                ));
            }
            select_evm_wallet(network).await?
        }
    };

    let mut dex_client = DexApiClient::new(network);

    if !is_direct {
        println!("{}", colors::dim("Authenticating with Orderly One..."));
    }

    dex_client.authenticate(&wallet_address, network).await?;

    if !is_direct {
        println!("{}", colors::green("Authenticated."));
        println!("{}", colors::dim("Checking DEX status..."));
        let dex_status = dex_client.get_dex().await;
        if !dex_status.exists {
            println!(
                "{}",
                colors::dim("No DEX found. Creating custom integration DEX...")
            );
            dex_client.create_custom_dex(None).await?;
            println!("{}", colors::green("Custom DEX created."));
        } else if dex_status.integration_type.as_deref() == Some("custom") {
            println!("{}", colors::dim("Existing custom DEX found."));
        } else {
            println!("{}", colors::dim("Existing DEX found."));
        }
        println!();
    }

    if is_direct {
        let broker_id = args
            .broker_id
            .as_deref()
            .filter(|b| !b.is_empty())
            .ok_or_else(|| {
                super::fail("--broker-id is required with --tx-hash in non-interactive mode.")
            })?;
        let chain = args
            .chain
            .as_deref()
            .filter(|c| !c.is_empty())
            .ok_or_else(|| super::fail("--chain is required with --tx-hash."))?;
        let chain_id = args
            .chain_id
            .ok_or_else(|| super::fail("--chain-id is required with --tx-hash."))?;
        let payment_type = args
            .payment_type
            .as_deref()
            .filter(|p| !p.is_empty())
            .ok_or_else(|| super::fail("--payment-type is required with --tx-hash."))?;
        let maker_fee = args
            .maker_fee
            .ok_or_else(|| super::fail("--maker-fee is required with --tx-hash."))?;
        let taker_fee = args
            .taker_fee
            .ok_or_else(|| super::fail("--taker-fee is required with --tx-hash."))?;
        let rwa_maker_fee = args
            .rwa_maker_fee
            .ok_or_else(|| super::fail("--rwa-maker-fee is required with --tx-hash."))?;
        let rwa_taker_fee = args
            .rwa_taker_fee
            .ok_or_else(|| super::fail("--rwa-taker-fee is required with --tx-hash."))?;

        if let Some(err) = fee_range_error(maker_fee, -0.5, 15.0, "--maker-fee")
            .or_else(|| fee_range_error(taker_fee, 3.0, 15.0, "--taker-fee"))
            .or_else(|| fee_range_error(rwa_maker_fee, -0.5, 15.0, "--rwa-maker-fee"))
            .or_else(|| fee_range_error(rwa_taker_fee, 5.0, 15.0, "--rwa-taker-fee"))
        {
            return Err(super::fail(err));
        }

        let dex_status = dex_client.get_dex().await;
        if !dex_status.exists {
            dex_client.create_custom_dex(None).await?;
        }

        let payload = verify_tx_payload(
            args.tx_hash.as_deref().unwrap_or_default(),
            chain,
            chain_id,
            broker_id,
            maker_fee,
            taker_fee,
            rwa_maker_fee,
            rwa_taker_fee,
            payment_type,
        );
        let result = dex_client.verify_tx(&payload).await?;
        if result.get("success").and_then(|s| s.as_bool()) == Some(true) {
            let orderly_client = OrderlyClient::new(network);
            register_and_finalize(
                &wallet_address,
                broker_id,
                &dex_client,
                &orderly_client,
                network,
            )
            .await?;
            println!();
        }
        output(&result, ctx.format);
        return Ok(());
    }

    // Interactive flow (requires a TTY for the prompts that follow).
    let fee_options = dex_client.get_fee_options(true).await?;

    println!("{}", colors::bold("Payment Options:"));
    let usdc_amount = fee_options
        .get("usdc")
        .and_then(|u| u.get("amount"))
        .map(crate::commands::settle::stringify_number)
        .unwrap_or_default();
    let usdt_amount = fee_options
        .get("usdt")
        .and_then(|u| u.get("amount"))
        .map(crate::commands::settle::stringify_number)
        .unwrap_or_default();
    println!("{} {}", colors::dim("  USDC:  "), usdc_amount);
    println!("{} {}", colors::dim("  USDT:  "), usdt_amount);
    if let Some(order) = fee_options.get("order") {
        if let Some(price) = order.get("currentPrice").and_then(|p| p.as_f64()) {
            let amount = order.get("amount").and_then(|a| a.as_f64()).unwrap_or(0.0);
            println!("{} {amount:.2} ORDER", colors::dim("  ORDER: "));
            println!(
                "{}",
                colors::dim(&format!(" (price: ${price:.4} per ORDER)"))
            );
        }
    }
    println!();
    println!(
        "{} {}",
        colors::dim("  Receiver: "),
        colors::cyan(
            fee_options
                .get("receiverAddress")
                .and_then(|r| r.as_str())
                .unwrap_or("")
        )
    );
    println!();

    println!("{}", colors::dim("Checking existing broker IDs..."));
    let existing_ids = fetch_existing_broker_ids(network).await;

    let broker_id = match args.broker_id.as_deref().filter(|b| !b.is_empty()) {
        Some(b) => {
            let lower = b.to_lowercase();
            if let Err(err) = validate_broker_id(&lower) {
                return Err(super::fail(err));
            }
            if existing_ids.contains(&lower) {
                return Err(super::fail(format!(
                    "Broker ID \"{lower}\" is already taken."
                )));
            }
            lower
        }
        None => {
            if !is_tty() {
                return Err(super::fail("Cancelled."));
            }
            loop {
                let value = super::prompt::input("Enter your desired broker ID")?.to_lowercase();
                if value.is_empty() {
                    return Err(super::fail("Cancelled."));
                }
                if let Err(err) = validate_broker_id(&value) {
                    println!("{}", colors::red(&err));
                    continue;
                }
                if existing_ids.contains(&value) {
                    println!("{}", colors::red("This broker ID is already taken"));
                    continue;
                }
                break value;
            }
        }
    };

    println!();

    let fees = if let (Some(mf), Some(tf), Some(rmf), Some(rtf)) = (
        args.maker_fee,
        args.taker_fee,
        args.rwa_maker_fee,
        args.rwa_taker_fee,
    ) {
        (mf, tf, rmf, rtf)
    } else {
        if !is_tty() {
            return Err(super::fail("Cancelled."));
        }
        println!("{}", colors::bold("Set Fee Rates (basis points):"));
        println!("{}", colors::dim("  Maker fee range: -0.5 to 15"));
        println!("{}", colors::dim("  Taker fee range: 3 to 15"));
        println!("{}", colors::dim("  RWA maker fee range: -0.5 to 15"));
        println!("{}", colors::dim("  RWA taker fee range: 5 to 15"));
        println!();

        let ask = |label: &str, default: f64, min: f64, max: f64| -> Result<f64, AppError> {
            loop {
                let value: String = dialoguer::Input::new()
                    .with_prompt(label)
                    .default(crate::output::js_f64_to_string(default))
                    .interact_text()
                    .map_err(|e| super::fail(format!("Prompt failed: {e}")))?;
                match validate_fee(&value, min, max, label) {
                    Ok(()) => break Ok(value.parse().unwrap_or(default)),
                    Err(err) => println!("{}", colors::red(&err)),
                }
            }
        };

        let maker_fee = ask("Maker fee (bps)", 0.0, -0.5, 15.0)?;
        let taker_fee = ask("Taker fee (bps)", 3.0, 3.0, 15.0)?;
        let rwa_maker_fee = ask("RWA maker fee (bps)", 0.0, -0.5, 15.0)?;
        let rwa_taker_fee = ask("RWA taker fee (bps)", 5.0, 5.0, 15.0)?;
        (maker_fee, taker_fee, rwa_maker_fee, rwa_taker_fee)
    };

    println!();

    let chains = chains_for(network);
    let mut selected_chain = args.chain.clone().filter(|c| !c.is_empty());
    let mut selected_chain_id = args.chain_id;

    if selected_chain.is_none() {
        if !is_tty() {
            return Err(super::fail("Cancelled."));
        }
        let items: Vec<String> = chains
            .iter()
            .map(|(_, name, id)| format!("{name} ({id})"))
            .collect();
        let idx = super::prompt::select("Select payment chain", &items)?;
        selected_chain = Some(chains[idx].0.to_string());
        selected_chain_id = Some(chains[idx].2);
    } else if selected_chain_id.is_none() {
        let key = selected_chain.as_deref().unwrap_or_default();
        let Some(chain_info) = chains.iter().find(|(k, _, _)| *k == key) else {
            return Err(super::fail(format!(
                "Unknown chain \"{key}\". Valid: {}",
                chains
                    .iter()
                    .map(|(k, _, _)| *k)
                    .collect::<Vec<_>>()
                    .join(", ")
            )));
        };
        selected_chain_id = Some(chain_info.2);
    }
    let selected_chain = selected_chain.unwrap_or_default();
    let selected_chain_id = selected_chain_id.unwrap_or(0);

    let payment_type = match args.payment_type.as_deref().filter(|p| !p.is_empty()) {
        Some(p) => p.to_string(),
        None => {
            if !is_tty() {
                return Err(super::fail("Cancelled."));
            }
            let items = vec!["USDC".to_string(), "USDT".to_string(), "ORDER".to_string()];
            let idx = super::prompt::select("Select payment token", &items)?;
            ["usdc", "usdt", "order"][idx].to_string()
        }
    };

    println!();
    println!("{}", colors::bold("━━━ Payment Instructions ━━━"));
    println!();
    let payment_amount = fee_options
        .get(&payment_type)
        .and_then(|p| p.get("amount"))
        .map(crate::commands::settle::stringify_number)
        .unwrap_or_default();
    println!(
        "{} {payment_amount} {}",
        colors::dim("  Send exactly: "),
        payment_type.to_uppercase()
    );
    println!(
        "{} {}",
        colors::dim("  To address:   "),
        colors::cyan(
            fee_options
                .get("receiverAddress")
                .and_then(|r| r.as_str())
                .unwrap_or("")
        )
    );
    println!(
        "{} {selected_chain} ({selected_chain_id})",
        colors::dim("  On chain:     ")
    );
    println!();
    println!(
        "{}",
        colors::yellow(
            "⚠️  Send the exact amount. After the transaction is confirmed, enter the tx hash below."
        )
    );
    println!();

    if !is_tty() {
        return Err(super::fail("Cancelled."));
    }
    let tx_hash = super::prompt::input("Enter payment transaction hash")?;
    if tx_hash.len() < 10 {
        return Err(super::fail("Cancelled."));
    }

    println!();
    println!(
        "{}",
        colors::dim("Verifying payment and creating broker ID...")
    );

    let payload = verify_tx_payload(
        &tx_hash,
        &selected_chain,
        selected_chain_id,
        &broker_id,
        fees.0,
        fees.1,
        fees.2,
        fees.3,
        &payment_type,
    );
    let result = dex_client.verify_tx(&payload).await?;

    if result.get("success").and_then(|s| s.as_bool()) == Some(true) {
        println!();
        println!("{}", colors::green("✅ Broker ID created successfully!"));
        let created_broker_id = result
            .get("brokerCreationData")
            .and_then(|d| d.get("brokerId"))
            .and_then(|b| b.as_str())
            .unwrap_or(&broker_id);
        println!(
            "{}",
            colors::dim(&format!("  Broker ID: {created_broker_id}"))
        );
        if let Some(hashes) = result
            .get("brokerCreationData")
            .and_then(|d| d.get("transactionHashes"))
            .and_then(|h| h.as_object())
        {
            for (label, hash) in hashes {
                println!(
                    "{}",
                    colors::dim(&format!("  {label}: {}", hash.as_str().unwrap_or_default()))
                );
            }
        }
        println!();

        let orderly_client = OrderlyClient::new(network);
        register_and_finalize(
            &wallet_address,
            &broker_id,
            &dex_client,
            &orderly_client,
            network,
        )
        .await?;
        println!();
    }
    output(&result, ctx.format);
    Ok(())
}

pub async fn broker_status(
    address: Option<&str>,
    network: Network,
    ctx: Ctx,
) -> Result<(), AppError> {
    let wallet_address = match address.filter(|a| !a.is_empty()) {
        Some(a) => a.to_string(),
        None => {
            if !is_tty() {
                return Err(super::fail_hints(
                    "--address is required in non-interactive mode.",
                    vec!["Example: orderly broker-status --address 0x1234...".to_string()],
                ));
            }
            select_evm_wallet(network).await?
        }
    };

    let mut dex_client = DexApiClient::new(network);
    dex_client.authenticate(&wallet_address, network).await?;

    let dex = dex_client.get_dex().await;

    if !dex.exists {
        output(
            &obj(vec![
                ("exists", Value::Bool(false)),
                (
                    "message",
                    Value::String(
                        "No DEX found for this wallet. Run `orderly broker-create` to get started."
                            .to_string(),
                    ),
                ),
            ]),
            ctx.format,
        );
        return Ok(());
    }

    let mut pairs = vec![("exists", Value::Bool(true))];
    if let Some(broker_id) = dex.broker_id {
        pairs.push(("brokerId", Value::String(broker_id)));
    }
    if let Some(broker_name) = dex.broker_name {
        pairs.push(("brokerName", Value::String(broker_name)));
    }
    if let Some(integration_type) = dex.integration_type {
        pairs.push(("integrationType", Value::String(integration_type)));
    }
    if let Some(is_graduated) = dex.is_graduated {
        pairs.push(("isGraduated", Value::Bool(is_graduated)));
    }
    if let Some(repo_url) = dex.repo_url {
        pairs.push(("repoUrl", repo_url));
    }
    output(&obj(pairs), ctx.format);
    Ok(())
}
