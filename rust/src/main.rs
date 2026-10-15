use clap::Parser;
use orderly::cli::Cli;
use orderly::commands;
use orderly::error::handle_error;

#[tokio::main]
async fn main() {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(err) => handle_clap_error(err),
    };

    if let Err(err) = commands::dispatch(cli).await {
        handle_error(err);
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

    let exit_code = if err.exit_code() == 0 { 0 } else { 1 };
    let _ = err.print();
    std::process::exit(exit_code);
}
