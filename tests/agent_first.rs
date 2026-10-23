//! Agent-facing guarantees: `--dry-run` payloads, typed exit codes, and
//! non-TTY safety. These run the real binary so the process status is covered.

use serde_json::Value;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_orderly")
}

fn run(args: &[&str]) -> std::process::Output {
    Command::new(bin())
        .args(args)
        .stdin(Stdio::null())
        .output()
        .expect("failed to run orderly")
}

/// A non-interactive account id that cannot resolve, so any accidental
/// keychain/authentication access would fail instead of sending a request.
const NO_SUCH_ACCOUNT: &str = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

#[test]
fn order_place_dry_run_prints_the_request_not_a_response() {
    let out = run(&[
        "order-place",
        "PERP_ETH_USDC",
        "BUY",
        "MARKET",
        "0.01",
        "--client-order-id",
        "agent-1",
        "--reduce-only",
        "--dry-run",
        "--account",
        NO_SUCH_ACCOUNT,
        "--network",
        "testnet",
    ]);
    assert!(
        out.status.success(),
        "dry-run failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let v: Value = serde_json::from_slice(&out.stdout).expect("dry-run must print JSON");
    assert_eq!(v["dryRun"], true);
    assert_eq!(v["method"], "POST");
    assert_eq!(v["path"], "/v1/order");
    assert_eq!(v["body"]["symbol"], "PERP_ETH_USDC");
    assert_eq!(v["body"]["order_type"], "MARKET");
    assert_eq!(v["body"]["side"], "BUY");
    assert_eq!(v["body"]["order_quantity"], "0.01");
    assert_eq!(v["body"]["client_order_id"], "agent-1");
    assert_eq!(v["body"]["reduce_only"], true);
    assert!(v.get("success").is_none(), "must not look like a response");
    assert!(v.get("order_id").is_none(), "must not look like a response");
}

#[test]
fn algo_order_place_dry_run_prints_the_request() {
    let out = run(&[
        "algo-order-place",
        "PERP_ETH_USDC",
        "SELL",
        "STOP",
        "0.01",
        "--trigger-price",
        "2000",
        "--dry-run",
        "--account",
        NO_SUCH_ACCOUNT,
        "--network",
        "testnet",
    ]);
    assert!(
        out.status.success(),
        "dry-run failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let v: Value = serde_json::from_slice(&out.stdout).expect("dry-run must print JSON");
    assert_eq!(v["dryRun"], true);
    assert_eq!(v["method"], "POST");
    assert_eq!(v["path"], "/v1/algo/order");
    assert_eq!(v["body"]["symbol"], "PERP_ETH_USDC");
    assert_eq!(v["body"]["algo_type"], "STOP");
    assert_eq!(v["body"]["side"], "SELL");
    assert_eq!(v["body"]["trigger_price"], "2000");
}

#[test]
fn unknown_command_exits_2() {
    let out = run(&["definitely-not-a-command"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("Unknown command"),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn missing_required_argument_exits_2() {
    let out = run(&["order-place"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("missing required args"),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn invalid_symbol_exits_2() {
    let out = run(&[
        "order-place",
        "BAD",
        "BUY",
        "MARKET",
        "0.01",
        "--account",
        NO_SUCH_ACCOUNT,
        "--network",
        "testnet",
    ]);
    assert_eq!(out.status.code(), Some(2));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("Invalid symbol"),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn prompting_path_with_closed_stdin_exits_2_with_the_flag_hint() {
    let mut child = Command::new(bin())
        .args(["wallet-create"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn orderly");

    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait().expect("try_wait") {
            Some(_) => break,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                panic!("prompting path hung with stdin closed");
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }

    let out = child.wait_with_output().expect("wait_with_output");
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("--type"),
        "hint should name --type, stderr: {stderr}"
    );
}
