use clap::Parser;
use orderly::cli::Cli;

fn main() {
    let cli = Cli::parse();
    println!(
        "{{\"network\":\"{}\",\"csv\":{},\"pretty\":{}}}",
        cli.network, cli.csv, cli.pretty
    );
}
