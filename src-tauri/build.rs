use std::{path::PathBuf, process::Command};

fn main() {
    build_foundation_models_bridge();
    tauri_build::build()
}

/// Compiles src/ai/bridge.swift into a static library for macOS 13 and links it with
/// FoundationModels weak-linked, so the app starts on systems without the framework.
fn build_foundation_models_bridge() {
    println!("cargo:rerun-if-changed=src/ai/bridge.swift");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let target = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("x86_64") => "x86_64-apple-macosx13.0",
        _ => "arm64-apple-macosx13.0",
    };
    let status = Command::new("xcrun")
        .args(["swiftc", "-emit-library", "-static", "-parse-as-library", "-O"])
        .args(["-target", target, "-module-name", "GitmenuFM", "-o"])
        .arg(out.join("libgitmenu_fm.a"))
        .arg("src/ai/bridge.swift")
        .status()
        .expect("xcrun swiftc (Xcode or the Command Line Tools) is required");
    assert!(status.success(), "compiling src/ai/bridge.swift failed");

    let sdk = xcrun(&["--show-sdk-path"]);
    let swiftc = PathBuf::from(xcrun(&["--find", "swiftc"]));
    let toolchain_lib = swiftc.parent().unwrap().parent().unwrap().join("lib/swift/macosx");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=gitmenu_fm");
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    println!("cargo:rustc-link-search=native={}", toolchain_lib.display());
    println!("cargo:rustc-link-arg=-Wl,-weak_framework,FoundationModels");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}

fn xcrun(args: &[&str]) -> String {
    let output = Command::new("xcrun").args(args).output().expect("xcrun");
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}
