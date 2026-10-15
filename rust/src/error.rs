//! Error reporting mirroring `error()` / `handleError()` in `src/lib/output.ts`.

use crate::colors;
use serde_json::Value;

/// A user-facing error: red message to stderr, optional dim hints, exit code 1.
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
        error(&self.message, &self.hints)
    }
}

/// Print a red error message (and dim hints) to stderr, then exit 1.
pub fn error(message: &str, hints: &[String]) -> ! {
    eprintln!("{}", colors::red(message));
    for hint in hints {
        eprintln!("{}", colors::dim(hint));
    }
    std::process::exit(1);
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
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Api { status, body } => {
                let (message, _) = format_api_error(*status, body);
                f.write_str(&message)
            }
            AppError::Msg(m) => f.write_str(m),
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

/// Mirrors `handleError`: prints and exits.
pub fn handle_error(err: AppError) -> ! {
    match err {
        AppError::Api { status, body } => {
            let (message, hints) = format_api_error(status, &body);
            error(&message, &hints);
        }
        AppError::Msg(message) => error(&message, &[]),
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
}
