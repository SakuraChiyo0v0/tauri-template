mod features;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(features::logging::plugin())
        .invoke_handler(tauri::generate_handler![features::logging::set_log_level])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
