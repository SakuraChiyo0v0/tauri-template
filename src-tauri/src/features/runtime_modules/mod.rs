pub mod manifest;
pub mod plan;
pub mod resolver;
pub mod store;
pub mod types;

use std::path::Path;

use semver::Version;
use tauri::{AppHandle, Manager};

use store::{
    ModuleStore, RuntimeModuleEntry, RuntimeModuleOperationResult, RuntimeModulePlanSnapshot,
};
use types::RuntimeModuleCommandError;

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
pub fn list_runtime_modules(
    app: AppHandle,
    legacy_disabled_module_ids: Option<Vec<String>>,
) -> Result<RuntimeModulePlanSnapshot, String> {
    module_store(&app)?.snapshot(legacy_disabled_module_ids.as_deref().unwrap_or_default())
}

#[tauri::command]
pub fn install_runtime_module(
    app: AppHandle,
    package_path: String,
) -> Result<RuntimeModuleOperationResult, String> {
    module_store(&app)?.install_with_plan(Path::new(&package_path))
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
) -> Result<RuntimeModuleOperationResult, RuntimeModuleCommandError> {
    module_store(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .rollback_with_plan(&module_id)
}

#[tauri::command]
pub fn set_runtime_module_enabled(
    app: AppHandle,
    module_id: String,
    enabled: bool,
) -> Result<RuntimeModuleOperationResult, RuntimeModuleCommandError> {
    module_store(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .set_enabled(&module_id, enabled)
}

#[tauri::command]
pub fn report_runtime_module_activation_failure(
    app: AppHandle,
    module_id: String,
    failed_version: String,
    message: String,
) -> Result<RuntimeModuleOperationResult, String> {
    module_store(&app)?.report_activation_failure_with_plan(&module_id, &failed_version, &message)
}

#[tauri::command]
pub fn uninstall_runtime_module(
    app: AppHandle,
    module_id: String,
) -> Result<RuntimeModuleOperationResult, RuntimeModuleCommandError> {
    module_store(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .uninstall_with_plan(&module_id)
}
