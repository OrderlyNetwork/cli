//! Orderly Network CLI library.
//!
//! The binary in `src/main.rs` is a thin wrapper around this crate so that all
//! logic is unit-testable. Module layout mirrors the TypeScript original under
//! `src/` in the repository root.

pub mod account_select;
pub mod api;
pub mod cli;
pub mod colors;
pub mod commands;
pub mod config;
pub mod contracts;
pub mod crypto;
pub mod dex_api;
pub mod error;
pub mod evm;
pub mod keychain;
pub mod output;
pub mod solana;
pub mod types;
pub mod ws;
