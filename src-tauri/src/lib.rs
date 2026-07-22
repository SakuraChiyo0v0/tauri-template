mod features;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(features::logging::plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("resolve application data directory: {error}"))?;
            app.manage(
                features::native_capabilities::runtime::NativeRuntimeState::new(
                    app.handle().clone(),
                    app_data,
                ),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            features::logging::set_log_level,
            features::runtime_modules::list_runtime_modules,
            features::runtime_modules::install_runtime_module,
            features::runtime_modules::approve_runtime_module_native_permissions,
            features::runtime_modules::revoke_runtime_module_native_permissions,
            features::runtime_modules::read_runtime_module_entry,
            features::runtime_modules::rollback_runtime_module,
            features::runtime_modules::set_runtime_module_enabled,
            features::runtime_modules::report_runtime_module_activation_failure,
            features::runtime_modules::uninstall_runtime_module,
            features::runtime_modules::execute_runtime_module_database,
            features::runtime_modules::select_runtime_module_database,
            features::runtime_modules::transact_runtime_module_database,
            features::runtime_modules::get_runtime_module_database_user_version,
            features::runtime_modules::set_runtime_module_database_user_version,
            features::runtime_modules::list_runtime_module_data,
            features::runtime_modules::clear_runtime_module_data,
            features::native_capabilities::runtime::create_runtime_module_native_session,
            features::native_capabilities::runtime::release_runtime_module_native_session,
            features::native_capabilities::runtime::read_runtime_module_private_file,
            features::native_capabilities::runtime::write_runtime_module_private_file,
            features::native_capabilities::runtime::list_runtime_module_file_grants,
            features::native_capabilities::runtime::read_runtime_module_granted_file,
            features::native_capabilities::runtime::write_runtime_module_granted_file,
            features::native_capabilities::runtime::list_runtime_module_granted_directory,
            features::native_capabilities::runtime::revoke_runtime_module_file_grant,
            features::native_capabilities::runtime::open_runtime_module_url,
            features::native_capabilities::runtime::open_runtime_module_granted_file,
            features::native_capabilities::runtime::reveal_runtime_module_granted_file,
            features::native_capabilities::runtime::run_runtime_module_process,
            features::native_capabilities::runtime::read_runtime_module_registry,
            features::native_capabilities::runtime::write_runtime_module_registry,
            features::native_capabilities::runtime::delete_runtime_module_registry_value,
            features::native_capabilities::runtime::update_runtime_module_tray_item,
            features::native_capabilities::runtime::list_runtime_module_shortcuts,
            features::native_capabilities::runtime::rebind_runtime_module_session_shortcut,
            features::native_capabilities::runtime::disable_runtime_module_session_shortcut,
            features::native_capabilities::runtime::list_runtime_module_native_file_grants,
            features::native_capabilities::runtime::create_runtime_module_file_grant,
            features::native_capabilities::runtime::revoke_runtime_module_admin_file_grant,
            features::native_capabilities::runtime::list_runtime_module_shortcut_statuses,
            features::native_capabilities::runtime::rebind_runtime_module_shortcut,
            features::native_capabilities::runtime::disable_runtime_module_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
