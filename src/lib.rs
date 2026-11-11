//! Orderly Network CLI library.
//!
//! The binary in `src/main.rs` is a thin wrapper around this crate so that all
//! logic is unit-testable. Module layout mirrors the TypeScript original under
//! `src/` in the repository root.
//!
//! Portable modules (`crypto`, `error`, `request`, `types`, `colors`) build for
//! both native and wasm32. Everything that needs reqwest, Tokio, the OS
//! keychain, a filesystem, or a terminal is behind the default `native`
//! feature.

pub mod colors;
pub mod crypto;
pub mod error;
pub mod request;
pub mod types;

#[cfg(feature = "native")]
pub mod account_select;
#[cfg(feature = "native")]
pub mod api;
#[cfg(feature = "native")]
pub mod cli;
#[cfg(feature = "native")]
pub mod commands;
#[cfg(feature = "native")]
pub mod config;
#[cfg(feature = "native")]
pub mod contracts;
#[cfg(feature = "native")]
pub mod dex_api;
#[cfg(feature = "native")]
pub mod evm;
#[cfg(feature = "native")]
pub mod help;
#[cfg(feature = "native")]
pub mod keychain;
#[cfg(feature = "native")]
pub mod output;
#[cfg(feature = "native")]
pub mod solana;
#[cfg(feature = "native")]
pub mod ws;
