//! Orderly Network CLI library.
//!
//! The binary in `src/main.rs` is a thin wrapper around this crate so that all
//! logic is unit-testable. Module layout mirrors the TypeScript original under
//! `src/` in the repository root.

pub mod cli;
pub mod colors;
pub mod config;
pub mod crypto;
pub mod error;
pub mod keychain;
pub mod output;
pub mod types;
