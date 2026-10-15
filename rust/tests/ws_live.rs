//! Live WebSocket test against Orderly testnet (network required).

use orderly::types::Network;
use orderly::ws::fetch_ws_snapshot;

#[tokio::test]
async fn orderbook_snapshot() {
    let snap = fetch_ws_snapshot("PERP_ETH_USDC", "orderbook", Network::Testnet, 10_000).await;
    if snap.success {
        let data = snap.data.expect("data present on success");
        assert!(data.get("asks").is_some() && data.get("bids").is_some());
    } else {
        eprintln!("SKIP: ws snapshot failed: {:?}", snap.error);
    }
}
