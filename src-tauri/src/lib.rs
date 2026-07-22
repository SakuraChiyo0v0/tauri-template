mod features;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(features::logging::plugin())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            features::logging::set_log_level,
            features::runtime_modules::list_runtime_modules,
            features::runtime_modules::install_runtime_module,
            features::runtime_modules::read_runtime_module_entry,
            features::runtime_modules::rollback_runtime_module,
            features::runtime_modules::set_runtime_module_enabled,
            features::runtime_modules::report_runtime_module_activation_failure,
            features::runtime_modules::uninstall_runtime_module,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
