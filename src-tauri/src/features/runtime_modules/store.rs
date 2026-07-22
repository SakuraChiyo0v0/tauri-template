use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use zip::ZipArchive;

use super::manifest::{RuntimeModuleManifest, is_module_id};

const MAX_PACKAGE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 10 * 1024 * 1024;
const MAX_FILES: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleVersionRecord {
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModuleError {
    pub version: String,
    pub message: String,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModuleState {
    pub active_version: String,
    pub previous_version: Option<String>,
    pub versions: BTreeMap<String, ModuleVersionRecord>,
    pub blocked_version: Option<String>,
    pub last_error: Option<RuntimeModuleError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRuntimeModule {
    pub manifest: RuntimeModuleManifest,
    pub active_version: String,
    pub previous_version: Option<String>,
    pub available_versions: Vec<String>,
    pub active_sha256: String,
    pub blocked_version: Option<String>,
    pub last_error: Option<RuntimeModuleError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModuleEntry {
    pub manifest: RuntimeModuleManifest,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationFailureResult {
    pub module: InstalledRuntimeModule,
    pub rolled_back: bool,
}

pub struct ModuleStore {
    root: PathBuf,
    host_version: Version,
}

impl ModuleStore {
    pub fn new(root: PathBuf, host_version: Version) -> Self {
        Self { root, host_version }
    }

    pub fn list(&self) -> Result<Vec<InstalledRuntimeModule>, String> {
        self.cleanup_staging()?;
        if !self.root.exists() {
            return Ok(Vec::new());
        }

        let mut modules = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(io_error("read module directory"))? {
            let entry = entry.map_err(io_error("read module directory entry"))?;
            if !entry
                .file_type()
                .map_err(io_error("inspect module directory entry"))?
                .is_dir()
            {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || !is_module_id(&name) {
                continue;
            }
            modules.push(self.describe(&name)?);
        }
        modules.sort_by(|left, right| left.manifest.name.cmp(&right.manifest.name));
        Ok(modules)
    }

    pub fn install(&self, package_path: &Path) -> Result<InstalledRuntimeModule, String> {
        if package_path.extension().and_then(|value| value.to_str()) != Some("mtp") {
            return Err("module package must use the .mtp extension".into());
        }
        self.cleanup_staging()?;
        let metadata =
            fs::metadata(package_path).map_err(io_error("read module package metadata"))?;
        if !metadata.is_file() || metadata.len() > MAX_PACKAGE_BYTES {
            return Err(format!("module package exceeds {MAX_PACKAGE_BYTES} bytes"));
        }

        let package = fs::read(package_path).map_err(io_error("read module package"))?;
        let sha256 = format!("{:x}", Sha256::digest(&package));
        let mut archive = ZipArchive::new(Cursor::new(&package))
            .map_err(|error| format!("invalid module ZIP package: {error}"))?;
        let paths = validate_archive(&mut archive)?;
        let manifest_bytes = read_archive_file(&mut archive, "manifest.json")?;
        let manifest =
            RuntimeModuleManifest::parse_and_validate(&manifest_bytes, &self.host_version)?;
        if !paths.contains(Path::new(&manifest.entry)) {
            return Err(format!("module entry is missing: {}", manifest.entry));
        }

        let module_dir = self.module_dir(&manifest.id);
        let state_path = module_dir.join("state.json");
        let existing_state = if state_path.exists() {
            Some(read_state(&state_path)?)
        } else {
            None
        };
        let incoming_version = Version::parse(&manifest.version)
            .map_err(|error| format!("invalid module version: {error}"))?;
        if let Some(state) = &existing_state {
            let active_version = Version::parse(&state.active_version)
                .map_err(|error| format!("invalid installed module state: {error}"))?;
            if incoming_version <= active_version {
                return Err(format!(
                    "module version {} is not newer than active version {}; use rollback for older versions",
                    incoming_version, active_version
                ));
            }
        }

        let final_version_dir = module_dir.join("versions").join(&manifest.version);
        if final_version_dir.exists() {
            return Err(format!(
                "module version {} is already installed",
                manifest.version
            ));
        }

        let staging_dir = self.root.join(".staging").join(format!(
            "{}-{}-{}",
            manifest.id,
            manifest.version,
            unique_suffix()
        ));
        fs::create_dir_all(&staging_dir).map_err(io_error("create module staging directory"))?;
        if let Err(error) = extract_archive(&mut archive, &staging_dir) {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(error);
        }

        fs::create_dir_all(module_dir.join("versions"))
            .map_err(io_error("create module versions directory"))?;
        fs::rename(&staging_dir, &final_version_dir)
            .map_err(io_error("activate staged module version"))?;

        let mut state = existing_state.unwrap_or_else(|| RuntimeModuleState {
            active_version: manifest.version.clone(),
            previous_version: None,
            versions: BTreeMap::new(),
            blocked_version: None,
            last_error: None,
        });
        let old_active = state.active_version.clone();
        state.active_version = manifest.version.clone();
        if old_active != manifest.version && !state.versions.is_empty() {
            state.previous_version = Some(old_active);
        }
        state
            .versions
            .insert(manifest.version.clone(), ModuleVersionRecord { sha256 });
        state.blocked_version = None;
        state.last_error = None;

        if let Err(error) = write_state(&module_dir, &state) {
            let _ = fs::remove_dir_all(&final_version_dir);
            return Err(error);
        }
        self.describe(&manifest.id)
    }

    pub fn read_entry(&self, module_id: &str) -> Result<RuntimeModuleEntry, String> {
        validate_module_id(module_id)?;
        let state = read_state(&self.module_dir(module_id).join("state.json"))?;
        if state.blocked_version.as_deref() == Some(&state.active_version) {
            return Err(format!(
                "module {module_id} version {} is blocked after activation failure",
                state.active_version
            ));
        }
        let manifest = self.read_manifest(module_id, &state.active_version)?;
        let entry_path = self
            .version_dir(module_id, &state.active_version)
            .join(&manifest.entry);
        let metadata = fs::metadata(&entry_path).map_err(io_error("read module entry metadata"))?;
        if metadata.len() > MAX_ENTRY_BYTES {
            return Err(format!("module entry exceeds {MAX_ENTRY_BYTES} bytes"));
        }
        let source = fs::read_to_string(&entry_path).map_err(io_error("read module entry"))?;
        Ok(RuntimeModuleEntry { manifest, source })
    }

    pub fn rollback(&self, module_id: &str) -> Result<InstalledRuntimeModule, String> {
        validate_module_id(module_id)?;
        let module_dir = self.module_dir(module_id);
        let mut state = read_state(&module_dir.join("state.json"))?;
        let previous = state
            .previous_version
            .clone()
            .ok_or_else(|| format!("module {module_id} has no previous version"))?;
        if !state.versions.contains_key(&previous) {
            return Err(format!("previous module version is missing: {previous}"));
        }
        let old_active = std::mem::replace(&mut state.active_version, previous);
        state.previous_version = Some(old_active);
        state.blocked_version = None;
        state.last_error = None;
        write_state(&module_dir, &state)?;
        self.describe(module_id)
    }

    pub fn report_activation_failure(
        &self,
        module_id: &str,
        failed_version: &str,
        message: &str,
    ) -> Result<ActivationFailureResult, String> {
        validate_module_id(module_id)?;
        if message.trim().is_empty() {
            return Err("activation failure message cannot be empty".into());
        }
        let module_dir = self.module_dir(module_id);
        let mut state = read_state(&module_dir.join("state.json"))?;
        if state.active_version != failed_version {
            return Err(format!(
                "cannot report failure for inactive version {failed_version}; active version is {}",
                state.active_version
            ));
        }

        let mut rolled_back = false;
        if let Some(previous) = state.previous_version.clone() {
            let previous_is_blocked = state.blocked_version.as_deref() == Some(previous.as_str());
            if state.versions.contains_key(&previous) && !previous_is_blocked {
                state.active_version = previous;
                state.previous_version = Some(failed_version.into());
                rolled_back = true;
            }
        }
        state.blocked_version = Some(failed_version.into());
        state.last_error = Some(RuntimeModuleError {
            version: failed_version.into(),
            message: message.trim().chars().take(1_000).collect(),
            occurred_at: unique_suffix(),
        });
        write_state(&module_dir, &state)?;

        Ok(ActivationFailureResult {
            module: self.describe(module_id)?,
            rolled_back,
        })
    }

    pub fn uninstall(&self, module_id: &str) -> Result<(), String> {
        validate_module_id(module_id)?;
        let module_dir = self.module_dir(module_id);
        if !module_dir.exists() {
            return Err(format!("module is not installed: {module_id}"));
        }
        fs::remove_dir_all(module_dir).map_err(io_error("remove installed module"))
    }

    fn describe(&self, module_id: &str) -> Result<InstalledRuntimeModule, String> {
        let state = read_state(&self.module_dir(module_id).join("state.json"))?;
        let manifest = self.read_manifest(module_id, &state.active_version)?;
        let active_sha256 = state
            .versions
            .get(&state.active_version)
            .ok_or_else(|| {
                format!(
                    "active module version is missing from state: {}",
                    state.active_version
                )
            })?
            .sha256
            .clone();
        let mut available_versions = state.versions.keys().cloned().collect::<Vec<_>>();
        available_versions.sort_by(|left, right| {
            let left = Version::parse(left).ok();
            let right = Version::parse(right).ok();
            right.cmp(&left)
        });
        Ok(InstalledRuntimeModule {
            manifest,
            active_version: state.active_version,
            previous_version: state.previous_version,
            available_versions,
            active_sha256,
            blocked_version: state.blocked_version,
            last_error: state.last_error,
        })
    }

    fn read_manifest(
        &self,
        module_id: &str,
        version: &str,
    ) -> Result<RuntimeModuleManifest, String> {
        let path = self.version_dir(module_id, version).join("manifest.json");
        let bytes = fs::read(path).map_err(io_error("read installed module manifest"))?;
        RuntimeModuleManifest::parse_and_validate(&bytes, &self.host_version)
    }

    fn cleanup_staging(&self) -> Result<(), String> {
        let staging = self.root.join(".staging");
        if staging.exists() {
            fs::remove_dir_all(&staging).map_err(io_error("clean module staging directory"))?;
        }
        Ok(())
    }

    fn module_dir(&self, module_id: &str) -> PathBuf {
        self.root.join(module_id)
    }

    fn version_dir(&self, module_id: &str, version: &str) -> PathBuf {
        self.module_dir(module_id).join("versions").join(version)
    }
}

fn validate_archive(
    archive: &mut ZipArchive<Cursor<&Vec<u8>>>,
) -> Result<HashSet<PathBuf>, String> {
    if archive.len() > MAX_FILES {
        return Err(format!(
            "module package contains more than {MAX_FILES} entries"
        ));
    }
    let mut paths = HashSet::new();
    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|error| format!("read ZIP entry: {error}"))?;
        let path = safe_archive_path(&file)?;
        if !paths.insert(path.clone()) {
            return Err(format!("duplicate module package path: {}", path.display()));
        }
        total_size = total_size.saturating_add(file.size());
        if total_size > MAX_EXPANDED_BYTES {
            return Err(format!(
                "expanded module package exceeds {MAX_EXPANDED_BYTES} bytes"
            ));
        }
        validate_package_path(&path, file.is_dir())?;
    }
    if !paths.contains(Path::new("manifest.json")) {
        return Err("module package is missing manifest.json".into());
    }
    Ok(paths)
}

fn safe_archive_path(file: &zip::read::ZipFile<'_, Cursor<&Vec<u8>>>) -> Result<PathBuf, String> {
    if file
        .unix_mode()
        .is_some_and(|mode| mode & 0o170000 == 0o120000)
    {
        return Err(format!("symbolic links are not allowed: {}", file.name()));
    }
    let path = Path::new(file.name());
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("unsafe module package path: {}", file.name()));
    }
    Ok(path.to_path_buf())
}

fn validate_package_path(path: &Path, is_dir: bool) -> Result<(), String> {
    if is_dir {
        return Ok(());
    }
    if matches!(path.to_str(), Some("manifest.json" | "index.js")) {
        return Ok(());
    }
    let allowed_asset = path.starts_with("assets")
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "css" | "json" | "png" | "jpg" | "jpeg" | "webp" | "svg" | "txt" | "wasm"
                )
            });
    if !allowed_asset {
        return Err(format!(
            "unsupported module package file: {}",
            path.display()
        ));
    }
    Ok(())
}

fn read_archive_file(
    archive: &mut ZipArchive<Cursor<&Vec<u8>>>,
    name: &str,
) -> Result<Vec<u8>, String> {
    let mut file = archive
        .by_name(name)
        .map_err(|error| format!("read {name} from package: {error}"))?;
    if file.size() > MAX_ENTRY_BYTES {
        return Err(format!(
            "module package entry {name} exceeds {MAX_ENTRY_BYTES} bytes"
        ));
    }
    let mut bytes = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut bytes)
        .map_err(io_error("read module package entry"))?;
    Ok(bytes)
}

fn extract_archive(
    archive: &mut ZipArchive<Cursor<&Vec<u8>>>,
    destination: &Path,
) -> Result<(), String> {
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("read ZIP entry: {error}"))?;
        let relative = safe_archive_path(&file)?;
        let output = destination.join(&relative);
        if file.is_dir() {
            fs::create_dir_all(&output).map_err(io_error("create module package directory"))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)
                .map_err(io_error("create module package parent directory"))?;
        }
        let mut target = File::create(&output).map_err(io_error("create installed module file"))?;
        std::io::copy(&mut file, &mut target).map_err(io_error("extract module package file"))?;
        target
            .sync_all()
            .map_err(io_error("flush installed module file"))?;
    }
    Ok(())
}

fn read_state(path: &Path) -> Result<RuntimeModuleState, String> {
    let bytes = fs::read(path).map_err(io_error("read module state"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("invalid module state: {error}"))
}

fn write_state(module_dir: &Path, state: &RuntimeModuleState) -> Result<(), String> {
    fs::create_dir_all(module_dir).map_err(io_error("create module state directory"))?;
    let mut temporary =
        NamedTempFile::new_in(module_dir).map_err(io_error("create temporary module state"))?;
    serde_json::to_writer_pretty(&mut temporary, state)
        .map_err(|error| format!("serialize module state: {error}"))?;
    temporary
        .write_all(b"\n")
        .map_err(io_error("write module state"))?;
    temporary
        .as_file_mut()
        .sync_all()
        .map_err(io_error("flush module state"))?;
    temporary
        .persist(module_dir.join("state.json"))
        .map_err(|error| format!("atomically replace module state: {}", error.error))?;
    Ok(())
}

fn validate_module_id(module_id: &str) -> Result<(), String> {
    if !is_module_id(module_id) || matches!(module_id, "system" | "logging") {
        return Err(format!("invalid or reserved module id: {module_id}"));
    }
    Ok(())
}

fn unique_suffix() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}

fn io_error(context: &'static str) -> impl FnOnce(std::io::Error) -> String {
    move |error| format!("{context}: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    fn manifest(version: &str) -> String {
        serde_json::json!({
            "schemaVersion": 1,
            "id": "hello-module",
            "name": "Hello Module",
            "description": "Runtime module used by tests",
            "version": version,
            "hostVersion": ">=0.1.0, <0.2.0",
            "sdkVersion": 1,
            "entry": "index.js",
            "navigation": [{
                "id": "hello-home",
                "title": "Hello",
                "element": "hello-module-home",
                "group": "main"
            }],
            "settings": []
        })
        .to_string()
    }

    fn package(
        directory: &Path,
        name: &str,
        version: &str,
        include_entry: bool,
        extra: &[(&str, &str)],
    ) -> PathBuf {
        let path = directory.join(format!("{name}.mtp"));
        let file = File::create(&path).unwrap();
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        archive.start_file("manifest.json", options).unwrap();
        archive.write_all(manifest(version).as_bytes()).unwrap();
        if include_entry {
            archive.start_file("index.js", options).unwrap();
            archive
                .write_all(b"export async function activate() {}")
                .unwrap();
        }
        for (path, contents) in extra {
            archive.start_file(*path, options).unwrap();
            archive.write_all(contents.as_bytes()).unwrap();
        }
        archive.finish().unwrap();
        path
    }

    fn store(directory: &Path) -> ModuleStore {
        ModuleStore::new(directory.join("modules"), Version::new(0, 1, 0))
    }

    #[test]
    fn installs_and_upgrades_without_losing_the_previous_version() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package(temp.path(), "v1", "1.0.0", true, &[]))
            .unwrap();
        let installed = store
            .install(&package(temp.path(), "v2", "1.1.0", true, &[]))
            .unwrap();

        assert_eq!(installed.active_version, "1.1.0");
        assert_eq!(installed.previous_version.as_deref(), Some("1.0.0"));
        assert_eq!(installed.available_versions, ["1.1.0", "1.0.0"]);
        assert!(
            store
                .read_entry("hello-module")
                .unwrap()
                .source
                .contains("activate")
        );
    }

    #[test]
    fn rejects_missing_entry_and_preserves_the_active_version() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package(temp.path(), "v1", "1.0.0", true, &[]))
            .unwrap();

        let error = store
            .install(&package(temp.path(), "v2", "1.1.0", false, &[]))
            .unwrap_err();
        assert!(error.contains("entry is missing"));
        assert_eq!(store.list().unwrap()[0].active_version, "1.0.0");
    }

    #[test]
    fn rejects_unsafe_paths_without_writing_outside_the_store() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        let package = package(
            temp.path(),
            "unsafe",
            "1.0.0",
            true,
            &[("../escape.txt", "no")],
        );

        let error = store.install(&package).unwrap_err();
        assert!(error.contains("unsafe") || error.contains("unsupported"));
        assert!(!temp.path().join("escape.txt").exists());
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn rejects_duplicate_or_lower_versions() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package(temp.path(), "v2", "2.0.0", true, &[]))
            .unwrap();

        assert!(
            store
                .install(&package(temp.path(), "same", "2.0.0", true, &[]))
                .unwrap_err()
                .contains("not newer")
        );
        assert!(
            store
                .install(&package(temp.path(), "lower", "1.9.0", true, &[]))
                .unwrap_err()
                .contains("not newer")
        );
        assert_eq!(store.list().unwrap()[0].active_version, "2.0.0");
    }

    #[test]
    fn rolls_back_an_upgrade_after_activation_failure() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package(temp.path(), "v1", "1.0.0", true, &[]))
            .unwrap();
        store
            .install(&package(temp.path(), "v2", "1.1.0", true, &[]))
            .unwrap();

        let result = store
            .report_activation_failure("hello-module", "1.1.0", "missing element")
            .unwrap();
        assert!(result.rolled_back);
        assert_eq!(result.module.active_version, "1.0.0");
        assert_eq!(result.module.blocked_version.as_deref(), Some("1.1.0"));
        assert_eq!(
            result.module.last_error.as_ref().unwrap().message,
            "missing element"
        );
    }

    #[test]
    fn blocks_a_first_version_after_activation_failure() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package(temp.path(), "v1", "1.0.0", true, &[]))
            .unwrap();

        let result = store
            .report_activation_failure("hello-module", "1.0.0", "activate failed")
            .unwrap();
        assert!(!result.rolled_back);
        assert_eq!(result.module.blocked_version.as_deref(), Some("1.0.0"));
        assert!(
            store
                .read_entry("hello-module")
                .unwrap_err()
                .contains("blocked")
        );
    }

    #[test]
    fn does_not_auto_restore_a_version_that_already_failed_activation() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package(temp.path(), "v1", "1.0.0", true, &[]))
            .unwrap();
        store
            .install(&package(temp.path(), "v2", "1.1.0", true, &[]))
            .unwrap();

        let first_failure = store
            .report_activation_failure("hello-module", "1.1.0", "v2 failed")
            .unwrap();
        assert!(first_failure.rolled_back);
        assert_eq!(first_failure.module.active_version, "1.0.0");

        let second_failure = store
            .report_activation_failure("hello-module", "1.0.0", "v1 also failed")
            .unwrap();
        assert!(!second_failure.rolled_back);
        assert_eq!(second_failure.module.active_version, "1.0.0");
        assert_eq!(
            second_failure.module.blocked_version.as_deref(),
            Some("1.0.0")
        );
    }

    #[test]
    fn supports_explicit_rollback_and_uninstall() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package(temp.path(), "v1", "1.0.0", true, &[]))
            .unwrap();
        store
            .install(&package(temp.path(), "v2", "1.1.0", true, &[]))
            .unwrap();

        let rolled_back = store.rollback("hello-module").unwrap();
        assert_eq!(rolled_back.active_version, "1.0.0");
        assert_eq!(rolled_back.previous_version.as_deref(), Some("1.1.0"));

        store.uninstall("hello-module").unwrap();
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    #[ignore = "manual smoke: set MTP_SMOKE_V1 and MTP_SMOKE_V2 to real package paths"]
    fn runs_the_real_package_lifecycle_smoke() {
        let first_package = std::env::var("MTP_SMOKE_V1").expect("MTP_SMOKE_V1 is required");
        let second_package = std::env::var("MTP_SMOKE_V2").expect("MTP_SMOKE_V2 is required");
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());

        let installed = store.install(Path::new(&first_package)).unwrap();
        assert_eq!(installed.active_version, "1.0.0");
        assert!(store.install(Path::new(&first_package)).is_err());
        assert_eq!(store.list().unwrap()[0].active_version, "1.0.0");

        let upgraded = store.install(Path::new(&second_package)).unwrap();
        assert_eq!(upgraded.active_version, "1.1.0");
        assert_eq!(upgraded.previous_version.as_deref(), Some("1.0.0"));

        let rolled_back = store.rollback("example-greeting").unwrap();
        assert_eq!(rolled_back.active_version, "1.0.0");
        store.uninstall("example-greeting").unwrap();
        assert!(store.list().unwrap().is_empty());
    }
}
