use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use semver::Version;
use serde::Serialize;

use super::{
    manifest::RuntimeModuleManifest,
    store::{ModuleStore, RuntimeModuleOperationResult},
    types::RuntimeModuleStatus,
};
use crate::features::native_capabilities::permissions::NativePermissionSummary;

const MAX_REPOSITORY_ENTRIES: usize = 1_000;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryPackageStatus {
    NotInstalled,
    UpdateAvailable,
    Installed,
    OlderVersion,
    Invalid,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPackage {
    pub file_name: String,
    pub manifest: Option<RuntimeModuleManifest>,
    pub installed_version: Option<String>,
    pub status: RepositoryPackageStatus,
    pub permission_summary: Vec<NativePermissionSummary>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInstallResult {
    pub module_id: String,
    pub version: String,
    pub selected_version: Option<String>,
    pub status: RuntimeModuleStatus,
    pub package_installed: bool,
    pub plan_changed: bool,
}

pub fn scan_repository(
    store: &ModuleStore,
    repository: &Path,
) -> Result<Vec<RepositoryPackage>, String> {
    let repository = canonical_repository(repository)?;
    let snapshot = store.snapshot(&[])?;
    let mut result = Vec::new();

    for entry in fs::read_dir(&repository).map_err(io_error("read module repository"))? {
        if result.len() == MAX_REPOSITORY_ENTRIES {
            return Err("module_repository_entry_limit".into());
        }
        let entry = entry.map_err(io_error("read module repository entry"))?;
        let file_type = entry
            .file_type()
            .map_err(io_error("inspect module repository entry"))?;
        if !file_type.is_file() || file_type.is_symlink() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if Path::new(&file_name)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("mtp"))
        {
            continue;
        }

        let path = match repository_package_path(&repository, &file_name) {
            Ok(path) => path,
            Err(error) => {
                result.push(invalid_package(file_name, error));
                continue;
            }
        };
        match store.inspect_package(&path) {
            Ok(manifest) => {
                let installed = snapshot
                    .modules
                    .iter()
                    .find(|module| module.manifest.id == manifest.id);
                let installed_version = installed.and_then(|module| {
                    module
                        .selected_version
                        .clone()
                        .or_else(|| Some(module.active_version.clone()))
                });
                let status = package_status(&manifest.version, installed_version.as_deref());
                let permission_summary = manifest.normalized_native_capabilities()?.summary();
                result.push(RepositoryPackage {
                    file_name,
                    manifest: Some(manifest),
                    installed_version,
                    status,
                    permission_summary,
                    error: None,
                });
            }
            Err(error) => result.push(invalid_package(file_name, error)),
        }
    }

    result.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(result)
}

pub fn install_repository_package(
    store: &ModuleStore,
    repository: &Path,
    file_name: &str,
) -> Result<(RepositoryInstallResult, RuntimeModuleOperationResult), String> {
    let repository = canonical_repository(repository)?;
    let package_path = repository_package_path(&repository, file_name)?;
    let operation = store.install_with_plan(&package_path)?;
    let installed = operation
        .modules
        .iter()
        .find(|module| module.manifest.id == operation.module_id)
        .ok_or("installed module is missing from plan snapshot")?;
    let result = RepositoryInstallResult {
        module_id: operation.module_id.clone(),
        version: installed.manifest.version.clone(),
        selected_version: installed.selected_version.clone(),
        status: installed.status,
        package_installed: operation.package_installed,
        plan_changed: operation.plan_changed,
    };
    Ok((result, operation))
}

fn canonical_repository(repository: &Path) -> Result<PathBuf, String> {
    let metadata =
        fs::symlink_metadata(repository).map_err(io_error("inspect module repository"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("module_repository_not_directory".into());
    }
    fs::canonicalize(repository).map_err(io_error("resolve module repository"))
}

fn repository_package_path(repository: &Path, file_name: &str) -> Result<PathBuf, String> {
    if file_name.is_empty()
        || file_name.contains(['/', '\\'])
        || file_name.chars().any(char::is_control)
        || Path::new(file_name).components().count() != 1
        || !matches!(
            Path::new(file_name).components().next(),
            Some(Component::Normal(_))
        )
        || Path::new(file_name)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("mtp"))
    {
        return Err("unsafe_module_repository_file_name".into());
    }
    let candidate = repository.join(file_name);
    let metadata =
        fs::symlink_metadata(&candidate).map_err(io_error("inspect repository package"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("module_repository_package_not_file".into());
    }
    let canonical = fs::canonicalize(&candidate).map_err(io_error("resolve repository package"))?;
    if canonical.parent() != Some(repository) {
        return Err("module_repository_path_escape".into());
    }
    Ok(canonical)
}

fn package_status(version: &str, installed_version: Option<&str>) -> RepositoryPackageStatus {
    let Some(installed_version) = installed_version else {
        return RepositoryPackageStatus::NotInstalled;
    };
    match (Version::parse(version), Version::parse(installed_version)) {
        (Ok(package), Ok(installed)) if package > installed => {
            RepositoryPackageStatus::UpdateAvailable
        }
        (Ok(package), Ok(installed)) if package < installed => {
            RepositoryPackageStatus::OlderVersion
        }
        _ => RepositoryPackageStatus::Installed,
    }
}

fn invalid_package(file_name: String, error: String) -> RepositoryPackage {
    RepositoryPackage {
        file_name,
        manifest: None,
        installed_version: None,
        status: RepositoryPackageStatus::Invalid,
        permission_summary: Vec::new(),
        error: Some(error),
    }
}

fn io_error(context: &'static str) -> impl FnOnce(std::io::Error) -> String {
    move |error| format!("{context}: {error}")
}

#[cfg(test)]
mod tests {
    use std::{fs::File, io::Write};

    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    use super::*;

    fn store(root: &Path) -> ModuleStore {
        ModuleStore::new(root.join("modules"), Version::new(0, 1, 0))
    }

    fn package(repository: &Path, file_name: &str, version: &str) -> PathBuf {
        let path = repository.join(file_name);
        let file = File::create(&path).unwrap();
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        archive.start_file("manifest.json", options).unwrap();
        archive
            .write_all(
                serde_json::json!({
                    "schemaVersion": 2,
                    "id": "hello-module",
                    "name": { "zh-CN": "问候模块", "en": "Hello Module" },
                    "description": { "zh-CN": "仓库测试模块", "en": "Repository test module" },
                    "version": version,
                    "hostVersion": ">=0.1.0, <0.2.0",
                    "sdkVersion": 2,
                    "entry": "index.js",
                    "dependencies": { "required": [], "optional": [] },
                    "navigation": [],
                    "settings": []
                })
                .to_string()
                .as_bytes(),
            )
            .unwrap();
        archive.start_file("index.js", options).unwrap();
        archive
            .write_all(b"export async function activate() {}")
            .unwrap();
        archive.finish().unwrap();
        path
    }

    #[test]
    fn scans_valid_and_invalid_packages_and_reports_upgrade_state() {
        let temp = tempfile::tempdir().unwrap();
        let repository = temp.path().join("repository");
        fs::create_dir(&repository).unwrap();
        let v1 = package(&repository, "hello-1.0.0.mtp", "1.0.0");
        fs::write(repository.join("broken.mtp"), b"not a zip").unwrap();
        let store = store(temp.path());

        let first = scan_repository(&store, &repository).unwrap();
        assert_eq!(first.len(), 2);
        assert!(
            first
                .iter()
                .any(|item| item.status == RepositoryPackageStatus::NotInstalled)
        );
        assert!(
            first
                .iter()
                .any(|item| item.status == RepositoryPackageStatus::Invalid)
        );

        store.install_with_plan(&v1).unwrap();
        package(&repository, "hello-1.1.0.mtp", "1.1.0");
        let second = scan_repository(&store, &repository).unwrap();
        assert!(
            second
                .iter()
                .any(|item| item.status == RepositoryPackageStatus::UpdateAvailable)
        );
    }

    #[test]
    fn rejects_constructed_paths_before_installing() {
        let temp = tempfile::tempdir().unwrap();
        let repository = temp.path().join("repository");
        fs::create_dir(&repository).unwrap();
        let store = store(temp.path());
        for file_name in [
            "../outside.mtp",
            "child/module.mtp",
            "child\\module.mtp",
            "module.zip",
        ] {
            assert!(install_repository_package(&store, &repository, file_name).is_err());
        }
        assert!(store.snapshot(&[]).unwrap().modules.is_empty());
    }

    #[test]
    fn final_install_revalidates_a_package_replaced_after_scan() {
        let temp = tempfile::tempdir().unwrap();
        let repository = temp.path().join("repository");
        fs::create_dir(&repository).unwrap();
        let package_path = package(&repository, "hello.mtp", "1.0.0");
        let store = store(temp.path());
        assert_eq!(
            scan_repository(&store, &repository).unwrap()[0].status,
            RepositoryPackageStatus::NotInstalled
        );

        fs::write(&package_path, b"replaced after scan").unwrap();
        assert!(install_repository_package(&store, &repository, "hello.mtp").is_err());
        assert!(store.snapshot(&[]).unwrap().modules.is_empty());
    }

    #[test]
    #[ignore = "manual smoke: set MTP_REPOSITORY_SMOKE to a real Host SDK V5 repository package"]
    fn runs_real_v5_repository_package_smoke() {
        let package = PathBuf::from(
            std::env::var("MTP_REPOSITORY_SMOKE").expect("MTP_REPOSITORY_SMOKE is required"),
        );
        let repository = package
            .parent()
            .expect("package must have a parent directory");
        let file_name = package
            .file_name()
            .and_then(|value| value.to_str())
            .expect("package name must be UTF-8");
        let temp = tempfile::tempdir().unwrap();
        let store = ModuleStore::new(temp.path().join("modules"), Version::new(0, 2, 0));

        let scanned = scan_repository(&store, repository).unwrap();
        let item = scanned
            .iter()
            .find(|item| item.file_name == file_name)
            .expect("package must be visible in repository scan");
        assert_eq!(item.status, RepositoryPackageStatus::NotInstalled);
        assert!(item.permission_summary.iter().any(|permission| matches!(
            permission,
            NativePermissionSummary::ModuleRepositoryInstall
        )));

        let (installed, _) = install_repository_package(&store, repository, file_name).unwrap();
        assert_eq!(installed.module_id, "local-module-market");
        assert_eq!(installed.status, RuntimeModuleStatus::Waiting);
    }
}
