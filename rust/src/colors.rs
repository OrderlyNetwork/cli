//! Minimal ANSI coloring that mirrors `kleur`'s enable/disable rules.
//!
//! Colors are enabled only when stdout is a TTY (and `NO_COLOR` is unset), or
//! when `FORCE_COLOR` is set. This matches the pipeline behaviour of the TS CLI,
//! where piped/agent output is plain text.

use std::io::IsTerminal;

pub fn enabled() -> bool {
    if std::env::var_os("NO_COLOR").is_some() {
        return false;
    }
    if std::env::var_os("FORCE_COLOR").is_some() {
        return true;
    }
    std::io::stdout().is_terminal()
}

fn wrap(code: &str, s: &str) -> String {
    if enabled() {
        format!("\u{1b}[{code}m{s}\u{1b}[{}m", close_for(code))
    } else {
        s.to_string()
    }
}

fn close_for(code: &str) -> &'static str {
    match code {
        "31" | "32" | "33" | "36" => "39",
        "2" | "1" => "22",
        _ => "0",
    }
}

pub fn red(s: &str) -> String {
    wrap("31", s)
}

pub fn green(s: &str) -> String {
    wrap("32", s)
}

pub fn yellow(s: &str) -> String {
    wrap("33", s)
}

pub fn cyan(s: &str) -> String {
    wrap("36", s)
}

pub fn dim(s: &str) -> String {
    wrap("2", s)
}

pub fn bold(s: &str) -> String {
    wrap("1", s)
}
