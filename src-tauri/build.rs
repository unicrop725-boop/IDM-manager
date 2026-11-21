fn main() {
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    if os == "windows" && env == "msvc" {
        // tauri-build normally embeds an application manifest whose only content is a dependency on
        // Common Controls v6. Test executables (`cargo test` of this crate) never get it, so they
        // die at startup with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139): the dialog code linked in via
        // tauri imports comctl32 v6 entry points. Embedding the *same* manifest through the linker
        // gives every target (app, host, tests) that dependency, with no duplicate resource.
        let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
            .expect("failed to run tauri-build");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    } else {
        tauri_build::build();
    }
}
