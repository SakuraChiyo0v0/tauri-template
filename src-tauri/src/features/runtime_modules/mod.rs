pub mod manifest;
pub mod store;

use std::path::Path;

use semver::Version;
use tauri::{AppHandle, Manager};

use store::{ActivationFailureResult, InstalledRuntimeModule, ModuleStore, RuntimeModuleEntry};

fn module_store(app: &AppHandle) -> Result<ModuleStore, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve application data directory: {error}"))?
        .join("modules");
    let host_version = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|error| format!("invalid host package version: {error}"))?;
    Ok(ModuleStore::new(root, host_version))
}

#[tauri::command]
pub fn list_runtime_modules(app: AppHandle) -> Result<Vec<InstalledRuntimeModule>, String> {
    module_store(&app)?.list()
}

#[tauri::command]
pub fn install_runtime_module(
    app: AppHandle,
    package_path: String,
) -> Result<InstalledRuntimeModule, String> {
    module_store(&app)?.install(Path::new(&package_path))
}

#[tauri::command]
pub fn read_runtime_module_entry(
    app: AppHandle,
    module_id: String,
) -> Result<RuntimeModuleEntry, String> {
    module_store(&app)?.read_entry(&module_id)
}

#[tauri::command]
pub fn rollback_runtime_module(
    app: AppHandle,
    module_id: String,
) -> Result<InstalledRuntimeModule, String> {
    module_store(&app)?.rollback(&module_id)
}

#[tauri::command]
pub fn report_runtime_module_activation_failure(
    app: AppHandle,
    module_id: String,
    failed_version: String,
    message: String,
) -> Result<ActivationFailureResult, String> {
    module_store(&app)?.report_activation_failure(&module_id, &failed_version, &message)
}

#[tauri::command]
pub fn uninstall_runtime_module(app: AppHandle, module_id: String) -> Result<(), String> {
    module_store(&app)?.uninstall(&module_id)
}
