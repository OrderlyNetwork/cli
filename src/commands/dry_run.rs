//! `--dry-run` output: the request that *would* be sent, never a response.

use crate::api::RequestSpec;
use crate::error::AppError;
use crate::output::{output, OutputFormat};

/// Print a request document with `dryRun: true`.
///
/// `requires` names any live-state lookups needed to complete the payload
/// (empty when the request is fully determined by the CLI arguments).
pub fn emit(spec: &RequestSpec, note: Option<&str>, requires: &[&str]) -> Result<(), AppError> {
    output(&spec.to_json(note, requires), OutputFormat::Json);
    Ok(())
}
