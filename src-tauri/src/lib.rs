// Beamfall — Tauri shell library entry.
// Tauri 2's mobile/desktop unified bootstrap calls `run()` from this lib.
// `main.rs` just delegates here so iOS/Android can share the same code path.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
