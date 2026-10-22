use clap::Parser;
use orderly::cli::Cli;
use orderly::commands;
use orderly::error::handle_error;

#[tokio::main]
async fn main() {
    check_negative_number_args();

    // `orderly` with no arguments (or `orderly help`) prints nothing and exits 0.
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let first = raw.first().map(|s| s.as_str()).unwrap_or("");
    if raw.is_empty() || first == "help" {
        std::process::exit(0);
    }

    // `orderly --help` / `orderly -h` print the hand-written overview
    // (mirroring the TS `DESCRIPTION` + `QUICK_START`) and the command list.
    if first == "--help" || first == "-h" {
        print!("{}", orderly::help::full_help());
        std::process::exit(0);
    }

    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(err) => handle_clap_error(err),
    };

    if let Err(err) = commands::dispatch(cli).await {
        handle_error(err);
    }
}

/// Mirror the TS CLI's pre-parse guard: `process.argv.slice(2)` scanned from
/// index 2 for `-<number>`-looking arguments (which shells/users mistake for
/// flags). Plain, uncoloured stderr, exit 1.
fn check_negative_number_args() {
    let re = regex::Regex::new(r"^-\d+(\.\d+)?$").unwrap();
    let raw: Vec<String> = std::env::args().skip(1).collect();
    for arg in raw.iter().skip(2) {
        if re.is_match(arg) {
            eprintln!(
                "Error: Invalid argument \"{arg}\". Negative numbers look like CLI flags.\n\
                 Use a positive value, or quote the value to avoid shell parsing issues."
            );
            std::process::exit(1);
        }
    }
}

/// Mirror the TypeScript CLI's diagnostics for parse failures (exit code 1).
fn handle_clap_error(err: clap::Error) -> ! {
    use clap::error::{ContextKind, ContextValue, ErrorKind};
    use clap::CommandFactory;

    // `orderly` with no subcommand prints the help overview and exits 0.
    if err.kind() == ErrorKind::MissingSubcommand {
        let mut command = Cli::command();
        let _ = command.print_help();
        println!();
        std::process::exit(0);
    }

    if err.kind() == ErrorKind::InvalidSubcommand {
        if let Some(ContextValue::String(command)) = err.get(ContextKind::InvalidSubcommand) {
            orderly::error::error(
                &format!("Unknown command: {command}"),
                &["Run orderly --help to see available commands.".to_string()],
            );
        }
    }

    // Mirror cac's "missing required args" diagnostic.
    if err.kind() == ErrorKind::MissingRequiredArgument {
        let raw: Vec<String> = std::env::args().skip(1).collect();
        if let Some(name) = raw.first() {
            if let Some(spec) = orderly::help::usage_spec(name) {
                orderly::error::error(
                    &format!("missing required args for command `{spec}`"),
                    &[
                        "Usage examples:".to_string(),
                        format!("  orderly {spec} --help"),
                    ],
                );
            }
        }
    }

    let exit_code = if err.exit_code() == 0 { 0 } else { 1 };
    let _ = err.print();
    std::process::exit(exit_code);
}
