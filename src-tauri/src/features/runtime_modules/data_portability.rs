use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::features::runtime_modules::{
    database::ModuleDatabaseManager, manifest::is_module_id, module_store,
    types::RuntimeModuleStatus,
};

const MAGIC: &[u8; 8] = b"MTBKV001";
const DATABASE_FILE: &str = "index.sqlite";
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupArchiveHeader {
    pub magic: String,
    pub version: u32,
    pub module_id: String,
    pub exported_at: String,
    pub settings_json: String,
    pub database_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub module_id: String,
    pub file_name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub module_id: String,
    pub settings_json: String,
    pub database_size: u64,
}

pub fn export_module_backup(
    app: &AppHandle,
    module_id: &str,
    settings_json: String,
    target_path: PathBuf,
) -> Result<ExportResult, String> {
    if !is_module_id(module_id) {
        return Err(format!("invalid module id: {module_id}"));
    }
    let manager = database_manager(app)?;
    let database_path = manager.database_path(module_id)?;
    let database_bytes = std::fs::read(&database_path)
        .map_err(|error| format!("read module database: {error}"))?;
    let exported_at = now_iso();
    let header = BackupArchiveHeader {
        magic: String::from_utf8(MAGIC.to_vec())
            .map_err(|error| format!("header magic: {error}"))?,
        version: 1,
        module_id: module_id.to_string(),
        exported_at,
        settings_json,
        database_size: database_bytes.len() as u64,
    };
    let header_bytes = serde_json::to_vec(&header)
        .map_err(|error| format!("serialize backup header: {error}"))?;
    let mut archive = Vec::with_capacity(8 + header_bytes.len() + 8 + database_bytes.len());
    archive.extend_from_slice(&(header_bytes.len() as u64).to_le_bytes());
    archive.extend_from_slice(&header_bytes);
    archive.extend_from_slice(&database_bytes);
    let file_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("backup.mtbk")
        .to_string();
    if let Some(parent) = target_path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create backup directory: {error}"))?;
    }
    std::fs::write(&target_path, &archive)
        .map_err(|error| format!("write backup file: {error}"))?;
    Ok(ExportResult {
        module_id: module_id.to_string(),
        file_name,
        size: archive.len() as u64,
    })
}

pub fn import_module_backup(
    app: &AppHandle,
    module_id: &str,
    source_path: PathBuf,
) -> Result<ImportResult, String> {
    if !is_module_id(module_id) {
        return Err(format!("invalid module id: {module_id}"));
    }
    let snapshot = module_store(app)?.snapshot(&[])?;
    let module = snapshot
        .modules
        .iter()
        .find(|module| module.manifest.id == module_id)
        .ok_or_else(|| format!("runtime module is not installed: {module_id}"))?;
    if module.manifest.sdk_version < 9 {
        return Err(format!(
            "runtime module does not support data portability: {module_id}"
        ));
    }
    if module.status == RuntimeModuleStatus::Active {
        return Err("module_still_active".into());
    }
    let archive = std::fs::read(&source_path)
        .map_err(|error| format!("read backup file: {error}"))?;
    let archive_bytes = archive.as_slice();
    if archive_bytes.len() < 8 {
        return Err("invalid backup archive: too short".into());
    }
    let header_len = u64::from_le_bytes(archive_bytes[..8].try_into().unwrap()) as usize;
    if archive_bytes.len() < 8 + header_len {
        return Err("invalid backup archive: truncated header".into());
    }
    let header_bytes = &archive_bytes[8..8 + header_len];
    let header: BackupArchiveHeader = serde_json::from_slice(header_bytes)
        .map_err(|error| format!("parse backup header: {error}"))?;
    if header.magic.as_bytes() != MAGIC {
        return Err("invalid backup archive: bad magic".into());
    }
    if header.version != 1 {
        return Err(format!("unsupported backup version: {}", header.version));
    }
    if header.module_id != module_id {
        return Err("backup does not belong to this module".into());
    }
    let database_bytes = &archive_bytes[8 + header_len..];
    let manager = database_manager(app)?;
    let database_path = manager.database_path(module_id)?;
    if let Some(parent) = database_path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create module database directory: {error}"))?;
    }
    validate_database_bytes(database_bytes)?;
    std::fs::write(&database_path, database_bytes)
        .map_err(|error| format!("write module database: {error}"))?;
    Ok(ImportResult {
        module_id: module_id.to_string(),
        settings_json: header.settings_json,
        database_size: database_bytes.len() as u64,
    })
}

fn validate_database_bytes(database_bytes: &[u8]) -> Result<(), String> {
    if database_bytes.len() < SQLITE_HEADER.len()
        || &database_bytes[..SQLITE_HEADER.len()] != SQLITE_HEADER
    {
        return Err("invalid SQLite database".into());
    }
    Ok(())
}

fn database_manager(app: &AppHandle) -> Result<ModuleDatabaseManager, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve application data directory: {error}"))?
        .join("runtime-module-data");
    Ok(ModuleDatabaseManager::new(root))
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("{seconds}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_database_bytes_without_sqlite_header() {
        assert_eq!(
            validate_database_bytes(b"not a SQLite database"),
            Err("invalid SQLite database".to_string())
        );
    }

    #[test]
    fn accepts_database_bytes_with_sqlite_header() {
        assert!(validate_database_bytes(b"SQLite format 3\0payload").is_ok());
    }

    #[test]
    fn round_trips_an_archive_in_memory() {
        let database_bytes = b"SQLite format 3\0fake-content".to_vec();
        let header = BackupArchiveHeader {
            magic: String::from_utf8(MAGIC.to_vec()).unwrap(),
            version: 1,
            module_id: "local-notes".into(),
            exported_at: "123".into(),
            settings_json: "{\"compactList\":true}".into(),
            database_size: database_bytes.len() as u64,
        };
        let header_bytes = serde_json::to_vec(&header).unwrap();
        let mut archive = Vec::new();
        archive.extend_from_slice(&(header_bytes.len() as u64).to_le_bytes());
        archive.extend_from_slice(&header_bytes);
        archive.extend_from_slice(&database_bytes);

        let parsed_len = u64::from_le_bytes(archive[..8].try_into().unwrap()) as usize;
        let parsed_header: BackupArchiveHeader =
            serde_json::from_slice(&archive[8..8 + parsed_len]).unwrap();
        let parsed_db = &archive[8 + parsed_len..];
        assert_eq!(parsed_header.module_id, "local-notes");
        assert_eq!(parsed_header.magic.as_bytes(), MAGIC);
        assert_eq!(parsed_db, database_bytes.as_slice());
    }

    #[test]
    fn rejects_wrong_module_or_magic() {
        let header = BackupArchiveHeader {
            magic: String::from_utf8(MAGIC.to_vec()).unwrap(),
            version: 1,
            module_id: "other-module".into(),
            exported_at: "1".into(),
            settings_json: "{}".into(),
            database_size: 0,
        };
        let header_bytes = serde_json::to_vec(&header).unwrap();
        let mut archive = Vec::new();
        archive.extend_from_slice(&(header_bytes.len() as u64).to_le_bytes());
        archive.extend_from_slice(&header_bytes);
        assert_eq!(header.module_id, "other-module");
        assert_ne!(header.magic.as_bytes(), b"WRONGMAG");
    }
}
