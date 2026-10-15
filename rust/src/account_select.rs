//! Account resolution + authenticated client, mirroring `src/lib/account-select.ts`.

use crate::api::OrderlyClient;
use crate::error::{AppError, OutputError};
use crate::keychain::{self, KeyPair};
use crate::types::Network;
use std::io::IsTerminal;

pub fn is_tty() -> bool {
    std::io::stdin().is_terminal() && std::io::stdout().is_terminal()
}

fn wallet_type_label(k: &keychain::StoredKey) -> String {
    k.wallet_type.clone().unwrap_or_default()
}

pub async fn resolve_account_id(
    account_id: Option<&str>,
    network: Network,
) -> Result<String, AppError> {
    if let Some(a) = account_id {
        if !a.is_empty() {
            return Ok(a.to_string());
        }
    }

    let keys = keychain::list_keys().await.map_err(AppError::Msg)?;
    let filtered: Vec<keychain::StoredKey> = keys
        .into_iter()
        .filter(|k| k.network == network.as_str())
        .collect();

    if filtered.is_empty() {
        return Err(OutputError::with_hints(
            format!("No accounts found for {network}."),
            vec!["Run `orderly wallet-add-key` to add an account.".to_string()],
        )
        .into());
    }

    if filtered.len() == 1 {
        return Ok(filtered[0].account_id.clone());
    }

    if !is_tty() {
        let mut hints = vec!["Available accounts:".to_string()];
        for k in &filtered {
            hints.push(format!("  {} ({})", k.account_id, wallet_type_label(k)));
        }
        hints.push("Run `orderly auth-list` to see all accounts.".to_string());
        return Err(OutputError::with_hints(
            "Multiple accounts found. Specify --account in non-interactive mode.",
            hints,
        )
        .into());
    }

    let items: Vec<String> = filtered
        .iter()
        .map(|k| format!("{} ({})", k.account_id, wallet_type_label(k)))
        .collect();
    let idx = dialoguer::Select::new()
        .with_prompt("Select account")
        .items(&items)
        .interact()
        .map_err(|e| AppError::Msg(e.to_string()))?;

    Ok(filtered[idx].account_id.clone())
}

pub async fn resolve_key_pair(
    account_id: Option<&str>,
    network: Network,
) -> Result<(String, KeyPair), AppError> {
    let acc_id = resolve_account_id(account_id, network).await?;
    let key_pair = keychain::get_key(&acc_id, network.as_str())
        .await
        .map_err(AppError::Msg)?
        .ok_or_else(|| {
            OutputError::new(format!("No key found for account {acc_id} on {network}"))
        })?;
    Ok((acc_id, key_pair))
}

pub async fn create_authenticated_client(
    account_id: Option<&str>,
    network: Network,
) -> Result<(String, KeyPair, OrderlyClient), AppError> {
    let (acc_id, key_pair) = resolve_key_pair(account_id, network).await?;
    let mut client = OrderlyClient::new(network);
    client.set_key_pair(key_pair.clone());
    Ok((acc_id, key_pair, client))
}
