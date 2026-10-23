//! Error reporting mirroring `error()` / `handleError()` in `src/lib/output.ts`.

use crate::colors;
use serde_json::Value;

/// A user-facing error: red message to stderr, optional dim hints.
#[derive(Debug, Clone)]
pub struct OutputError {
    pub message: String,
    pub hints: Vec<String>,
}

impl OutputError {
    pub fn new(message: impl Into<String>) -> Self {
        OutputError {
            message: message.into(),
            hints: Vec::new(),
        }
    }

    pub fn with_hints(message: impl Into<String>, hints: Vec<String>) -> Self {
        OutputError {
            message: message.into(),
            hints,
        }
    }

    pub fn invalid_symbol(symbol: &str) -> Self {
        OutputError::with_hints(
            format!(
                "Invalid symbol: \"{symbol}\". Expected format: PERP_<BASE>_<QUOTE> (e.g. PERP_ETH_USDC)."
            ),
            vec!["Run `orderly symbols` to see available symbols.".to_string()],
        )
    }

    pub fn report(&self) -> ! {
        let code = if is_auth_message(&self.message) {
            exit_code::AUTH
        } else {
            exit_code::USAGE
        };
        error_with_code(&self.message, &self.hints, code)
    }
}

/// Print a red error message (and dim hints) to stderr, then exit 1.
pub fn error(message: &str, hints: &[String]) -> ! {
    error_with_code(message, hints, 1)
}

/// Same output as [`error`], with an explicit process exit status.
pub fn error_with_code(message: &str, hints: &[String], code: i32) -> ! {
    eprintln!("{}", colors::red(message));
    for hint in hints {
        eprintln!("{}", colors::dim(hint));
    }
    std::process::exit(code);
}

/// Convenience for `error(msg)` with no hints.
pub fn die(message: &str) -> ! {
    error(message, &[])
}

#[derive(Debug, Clone)]
pub enum AppError {
    /// An HTTP error carrying the status code and the raw response body text.
    Api { status: u16, body: String },
    /// A generic error.
    Msg(String),
    /// A user-facing error carrying message + hints (mirrors `error(msg, hints)`).
    User(OutputError),
}

/// Stable process exit codes (documented for agents and scripts).
pub mod exit_code {
    /// Success.
    pub const SUCCESS: i32 = 0;
    /// Generic / unexpected failure.
    pub const GENERIC: i32 = 1;
    /// Usage or validation error (bad flags, invalid symbol, missing argument).
    pub const USAGE: i32 = 2;
    /// Authentication / authorization error.
    pub const AUTH: i32 = 3;
    /// Trading rejection (margin, balance, engine rejection).
    pub const TRADING: i32 = 4;
    /// Transient failure (429, 5xx, timeout, connection reset).
    pub const TRANSIENT: i32 = 5;
}

fn is_auth_message(message: &str) -> bool {
    let m = message.to_lowercase();
    m.contains("no accounts found")
        || m.contains("no key found")
        || m.contains("no key pair")
        || m.contains("not authenticated")
        || m.contains("unauthorized")
        || (m.contains("api key")
            && (m.contains("invalid")
                || m.contains("expired")
                || m.contains("revoked")
                || m.contains("missing")))
}

fn is_transient_message(message: &str) -> bool {
    let m = message.to_lowercase();
    m.contains("timed out")
        || m.contains("timeout")
        || m.contains("connection reset")
        || m.contains("connection refused")
        || m.contains("connection closed")
        || m.contains("broken pipe")
        || m.contains("dns error")
}

fn is_trading_rejection(body: &str) -> bool {
    let body = body.to_lowercase();
    [
        "insufficient",
        "not enough",
        "margin",
        "balance",
        "reject",
        "reduce-only",
        "reduce only",
    ]
    .iter()
    .any(|needle| body.contains(needle))
}

impl AppError {
    /// Map an error onto the stable exit-code taxonomy.
    pub fn exit_code(&self) -> i32 {
        match self {
            AppError::Api { status, body } => match status {
                401 | 403 => exit_code::AUTH,
                408 | 429 => exit_code::TRANSIENT,
                500..=599 => exit_code::TRANSIENT,
                400 | 422 if is_trading_rejection(body) => exit_code::TRADING,
                400..=499 => exit_code::USAGE,
                _ => exit_code::GENERIC,
            },
            AppError::Msg(message) => {
                if is_auth_message(message) {
                    exit_code::AUTH
                } else if is_transient_message(message) {
                    exit_code::TRANSIENT
                } else {
                    exit_code::GENERIC
                }
            }
            AppError::User(e) => {
                if is_auth_message(&e.message) {
                    exit_code::AUTH
                } else {
                    exit_code::USAGE
                }
            }
        }
    }
}

impl From<OutputError> for AppError {
    fn from(e: OutputError) -> Self {
        AppError::User(e)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Api { status, body } => {
                let (message, _) = format_api_error(*status, body);
                f.write_str(&message)
            }
            AppError::Msg(m) => f.write_str(m),
            AppError::User(e) => f.write_str(&e.message),
        }
    }
}
impl std::error::Error for AppError {}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Msg(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Msg(s.to_string())
    }
}

fn code_to_string(code: &Value) -> String {
    match code {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

/// Produce the `(message, hints)` pair that `handleError` would emit.
pub fn format_api_error(status: u16, body: &str) -> (String, Vec<String>) {
    if status == 429 {
        return (
            "Rate limited. Please wait before trying again.".to_string(),
            vec![],
        );
    }

    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let raw_is_html = body.trim_start().starts_with('<');

    let code = parsed.as_ref().and_then(|v| v.get("code")).cloned();

    let message = if raw_is_html {
        format!("Request failed with status {status}")
    } else {
        parsed
            .as_ref()
            .and_then(|v| v.get("message"))
            .and_then(|m| m.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| match &parsed {
                Some(v) => serde_json::to_string(v).unwrap_or_default(),
                None => body.to_string(),
            })
    };

    let mut parts = vec![format!("API Error [{status}]")];
    if let Some(c) = code {
        parts.push(format!("[{}]", code_to_string(&c)));
    }
    parts.push(format!(": {message}"));
    (parts.join(" "), vec![])
}

/// Mirrors `handleError`: prints and exits with the taxonomy code.
pub fn handle_error(err: AppError) -> ! {
    let code = err.exit_code();
    match err {
        AppError::Api { status, body } => {
            let (message, hints) = format_api_error(status, &body);
            error_with_code(&message, &hints, code);
        }
        AppError::Msg(message) => error_with_code(&message, &[], code),
        AppError::User(e) => error_with_code(&e.message, &e.hints, code),
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_error_with_code_and_message() {
        let (msg, hints) = format_api_error(400, r#"{"code":1001,"message":"bad request"}"#);
        assert_eq!(msg, "API Error [400] [1001] : bad request");
        assert!(hints.is_empty());
    }

    #[test]
    fn api_error_message_only() {
        let (msg, _) = format_api_error(404, r#"{"message":"not found"}"#);
        assert_eq!(msg, "API Error [404] : not found");
    }

    #[test]
    fn api_error_html_body() {
        let (msg, _) = format_api_error(502, "<html>bad gateway</html>");
        assert_eq!(msg, "API Error [502] : Request failed with status 502");
    }

    #[test]
    fn api_error_plain_body() {
        let (msg, _) = format_api_error(500, r#"{"error":"oops"}"#);
        assert_eq!(msg, r#"API Error [500] : {"error":"oops"}"#);
    }

    #[test]
    fn api_error_rate_limited() {
        let (msg, _) = format_api_error(429, "anything");
        assert_eq!(msg, "Rate limited. Please wait before trying again.");
    }

    fn api(status: u16, body: &str) -> AppError {
        AppError::Api {
            status,
            body: body.to_string(),
        }
    }

    #[test]
    fn exit_code_taxonomy_for_api_errors() {
        use exit_code::*;
        assert_eq!(api(401, "{}").exit_code(), AUTH);
        assert_eq!(api(403, "{}").exit_code(), AUTH);
        assert_eq!(api(429, "{}").exit_code(), TRANSIENT);
        assert_eq!(api(500, "{}").exit_code(), TRANSIENT);
        assert_eq!(api(503, "<html>down</html>").exit_code(), TRANSIENT);
        assert_eq!(
            api(400, r#"{"code":1001,"message":"Insufficient margin"}"#).exit_code(),
            TRADING
        );
        assert_eq!(
            api(422, r#"{"message":"order rejected by engine"}"#).exit_code(),
            TRADING
        );
        assert_eq!(
            api(400, r#"{"message":"invalid symbol"}"#).exit_code(),
            USAGE
        );
        assert_eq!(api(404, "{}").exit_code(), USAGE);
    }

    #[test]
    fn exit_code_taxonomy_for_application_errors() {
        use exit_code::*;
        assert_eq!(AppError::Msg("boom".into()).exit_code(), GENERIC);
        assert_eq!(
            AppError::Msg("No key pair set. Please authenticate first.".into()).exit_code(),
            AUTH
        );
        assert_eq!(
            AppError::Msg("error sending request: connection reset by peer".into()).exit_code(),
            TRANSIENT
        );
        assert_eq!(
            AppError::User(OutputError::invalid_symbol("nope")).exit_code(),
            USAGE
        );
        assert_eq!(
            AppError::User(OutputError::new("No key found for account 0x1")).exit_code(),
            AUTH
        );
    }
}
