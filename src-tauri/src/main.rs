// Prevents an extra console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // git and ssh start this executable to ask for credentials or a commit message
    if let Some(code) = gitside_lib::run_helper() {
        std::process::exit(code);
    }
    gitside_lib::run();
}
