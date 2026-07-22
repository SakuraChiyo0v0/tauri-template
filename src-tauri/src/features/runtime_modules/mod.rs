pub mod database;
pub mod manifest;
pub mod plan;
pub mod resolver;
pub mod store;
pub mod types;

use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
};

use semver::Version;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::features::native_capabilities::runtime::NativeRuntimeState;

use database::{
    DatabaseExecuteResult, DatabaseStatement, ModuleDataInventoryItem, ModuleDatabaseManager,
};
use store::{
    ModuleStore, RuntimeModuleEntry, RuntimeModuleOperationResult, RuntimeModulePlanSnapshot,
};
use types::{RuntimeModuleCommandError, RuntimeModuleStatus};

pub(crate) fn module_store(app: &AppHandle) -> Result<ModuleStore, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve application data directory: {error}"))?
        .join("modules");
    let host_version = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|error| format!("invalid host package version: {error}"))?;
    Ok(ModuleStore::new(root, host_version))
}

fn database_manager(app: &AppHandle) -> Result<ModuleDatabaseManager, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve application data directory: {error}"))?
        .join("runtime-module-data");
    Ok(ModuleDatabaseManager::new(root))
}

fn require_active_database_module(app: &AppHandle, module_id: &str) -> Result<(), String> {
    let snapshot = module_store(app)?.snapshot(&[])?;
    let module = snapshot
        .modules
        .iter()
        .find(|module| module.manifest.id == module_id)
        .ok_or_else(|| format!("runtime module is not installed: {module_id}"))?;
    if module.manifest.sdk_version != 2 && module.manifest.sdk_version != 3 {
        return Err(format!(
            "runtime module does not use Host SDK V2 or V3: {module_id}"
        ));
    }
    if module.status != RuntimeModuleStatus::Active {
        return Err(format!("runtime module is not active: {module_id}"));
    }
    Ok(())
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
    native: State<'_, NativeRuntimeState>,
    package_path: String,
) -> Result<RuntimeModuleOperationResult, String> {
    let result = module_store(&app)?.install_with_plan(Path::new(&package_path))?;
    if result.plan_changed {
        native.release_module(&result.module_id);
    }
    Ok(result)
}

#[tauri::command]
pub fn approve_runtime_module_native_permissions(
    app: AppHandle,
    native: State<'_, NativeRuntimeState>,
    module_id: String,
    version: String,
) -> Result<RuntimeModuleOperationResult, String> {
    let result = module_store(&app)?.approve_native_permissions(&module_id, &version)?;
    native.release_module(&module_id);
    Ok(result)
}

#[tauri::command]
pub fn revoke_runtime_module_native_permissions(
    app: AppHandle,
    native: State<'_, NativeRuntimeState>,
    module_id: String,
) -> Result<RuntimeModuleOperationResult, String> {
    let result = module_store(&app)?.revoke_native_permissions(&module_id)?;
    native.release_module(&module_id);
    Ok(result)
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
    native: State<'_, NativeRuntimeState>,
    module_id: String,
) -> Result<RuntimeModuleOperationResult, RuntimeModuleCommandError> {
    let result = module_store(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .rollback_with_plan(&module_id)?;
    native.release_module(&module_id);
    Ok(result)
}

#[tauri::command]
pub fn set_runtime_module_enabled(
    app: AppHandle,
    native: State<'_, NativeRuntimeState>,
    module_id: String,
    enabled: bool,
) -> Result<RuntimeModuleOperationResult, RuntimeModuleCommandError> {
    let result = module_store(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .set_enabled(&module_id, enabled)?;
    if !enabled {
        native.release_module(&module_id);
    }
    Ok(result)
}

#[tauri::command]
pub fn report_runtime_module_activation_failure(
    app: AppHandle,
    native: State<'_, NativeRuntimeState>,
    module_id: String,
    failed_version: String,
    message: String,
) -> Result<RuntimeModuleOperationResult, String> {
    let result = module_store(&app)?.report_activation_failure_with_plan(
        &module_id,
        &failed_version,
        &message,
    )?;
    native.release_module(&module_id);
    Ok(result)
}

#[tauri::command]
pub fn uninstall_runtime_module(
    app: AppHandle,
    native: State<'_, NativeRuntimeState>,
    module_id: String,
) -> Result<RuntimeModuleOperationResult, RuntimeModuleCommandError> {
    let result = module_store(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .uninstall_with_plan(&module_id)?;
    native.release_module(&module_id);
    Ok(result)
}

#[tauri::command]
pub fn execute_runtime_module_database(
    app: AppHandle,
    module_id: String,
    sql: String,
    params: Vec<Value>,
) -> Result<DatabaseExecuteResult, RuntimeModuleCommandError> {
    require_active_database_module(&app, &module_id).map_err(RuntimeModuleCommandError::from)?;
    database_manager(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .execute(&module_id, &sql, &params)
        .map_err(RuntimeModuleCommandError::from)
}

#[tauri::command]
pub fn select_runtime_module_database(
    app: AppHandle,
    module_id: String,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<BTreeMap<String, Value>>, RuntimeModuleCommandError> {
    require_active_database_module(&app, &module_id).map_err(RuntimeModuleCommandError::from)?;
    database_manager(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .select(&module_id, &sql, &params)
        .map_err(RuntimeModuleCommandError::from)
}

#[tauri::command]
pub fn transact_runtime_module_database(
    app: AppHandle,
    module_id: String,
    statements: Vec<DatabaseStatement>,
) -> Result<Vec<DatabaseExecuteResult>, RuntimeModuleCommandError> {
    require_active_database_module(&app, &module_id).map_err(RuntimeModuleCommandError::from)?;
    database_manager(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .transaction(&module_id, &statements)
        .map_err(RuntimeModuleCommandError::from)
}

#[tauri::command]
pub fn get_runtime_module_database_user_version(
    app: AppHandle,
    module_id: String,
) -> Result<u32, RuntimeModuleCommandError> {
    require_active_database_module(&app, &module_id).map_err(RuntimeModuleCommandError::from)?;
    database_manager(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .get_user_version(&module_id)
        .map_err(RuntimeModuleCommandError::from)
}

#[tauri::command]
pub fn set_runtime_module_database_user_version(
    app: AppHandle,
    module_id: String,
    version: u32,
) -> Result<(), RuntimeModuleCommandError> {
    require_active_database_module(&app, &module_id).map_err(RuntimeModuleCommandError::from)?;
    database_manager(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .set_user_version(&module_id, version)
        .map_err(RuntimeModuleCommandError::from)
}

#[tauri::command]
pub fn list_runtime_module_data(
    app: AppHandle,
) -> Result<Vec<ModuleDataInventoryItem>, RuntimeModuleCommandError> {
    let installed = module_store(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .snapshot(&[])
        .map_err(RuntimeModuleCommandError::from)?
        .modules
        .into_iter()
        .map(|module| module.manifest.id)
        .collect::<HashSet<_>>();
    database_manager(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .inventory(&installed)
        .map_err(RuntimeModuleCommandError::from)
}

#[tauri::command]
pub fn clear_runtime_module_data(
    app: AppHandle,
    module_id: String,
) -> Result<Vec<ModuleDataInventoryItem>, RuntimeModuleCommandError> {
    let snapshot = module_store(&app)
        .map_err(RuntimeModuleCommandError::from)?
        .snapshot(&[])
        .map_err(RuntimeModuleCommandError::from)?;
    let active = snapshot.modules.iter().any(|module| {
        module.manifest.id == module_id && module.status == RuntimeModuleStatus::Active
    });
    let installed = snapshot
        .modules
        .into_iter()
        .map(|module| module.manifest.id)
        .collect::<HashSet<_>>();
    let manager = database_manager(&app).map_err(RuntimeModuleCommandError::from)?;
    manager
        .clear(&module_id, active)
        .map_err(RuntimeModuleCommandError::from)?;
    manager
        .inventory(&installed)
        .map_err(RuntimeModuleCommandError::from)
}
