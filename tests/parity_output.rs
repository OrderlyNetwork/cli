//! Parity test: the Rust `render()` must reproduce the exact stdout/stderr that
//! the real TypeScript `src/lib/output.ts` produces.
//!
//! Fixtures were recorded from the TypeScript oracle; see `parity/README.md`.

use orderly::output::{render, OutputFormat};
use serde_json::Value;

#[test]
fn output_matches_ts_fixtures() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("parity/fixtures/output.json");
    let text =
        std::fs::read_to_string(&path).expect("missing parity fixture; see parity/README.md");
    let cases: Vec<Value> = serde_json::from_str(&text).expect("valid fixture json");
    assert!(!cases.is_empty(), "no fixtures found");

    let mut checked = 0;
    for case in &cases {
        let name = case["name"].as_str().unwrap();
        let format = match case["format"].as_str().unwrap() {
            "csv" => OutputFormat::Csv,
            _ => OutputFormat::Json,
        };
        let (stdout, stderr) = render(&case["data"], format, false);
        assert_eq!(
            stdout,
            case["stdout"].as_str().unwrap(),
            "stdout mismatch for `{name}`"
        );
        assert_eq!(
            stderr,
            case["stderr"].as_str().unwrap(),
            "stderr mismatch for `{name}`"
        );
        checked += 1;
    }
    assert_eq!(checked, cases.len());
}
