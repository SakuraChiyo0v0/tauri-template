use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

use crate::features::runtime_modules::manifest::is_module_id;

pub const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_DIRECTORY_ENTRIES: usize = 1_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GrantKind {
    File,
    Directory,
    Executable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GrantAccess {
    pub read: bool,
    pub write: bool,
    pub list: bool,
    pub execute: bool,
}

impl GrantAccess {
    #[cfg(test)]
    pub fn read_write() -> Self {
        Self {
            read: true,
            write: true,
            list: false,
            execute: false,
        }
    }

    #[cfg(test)]
    pub fn execute() -> Self {
        Self {
            read: false,
            write: false,
            list: false,
            execute: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileGrant {
    pub id: String,
    pub module_id: String,
    pub display_name: String,
    pub kind: GrantKind,
    pub access: GrantAccess,
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileGrantSummary {
    pub id: String,
    pub module_id: String,
    pub display_name: String,
    pub kind: GrantKind,
    pub access: GrantAccess,
}

impl From<FileGrant> for FileGrantSummary {
    fn from(grant: FileGrant) -> Self {
        Self {
            id: grant.id,
            module_id: grant.module_id,
            display_name: grant.display_name,
            kind: grant.kind,
            access: grant.access,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub kind: GrantKind,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct GrantFile {
    grants: BTreeMap<String, FileGrant>,
}

#[derive(Debug, Clone)]
pub struct FilesystemManager {
    private_root: PathBuf,
    grants_path: PathBuf,
}

impl FilesystemManager {
    pub fn new(private_root: PathBuf, grants_path: PathBuf) -> Self {
        Self {
            private_root,
            grants_path,
        }
    }

    pub fn read_private(&self, module_id: &str, relative_path: &str) -> Result<Vec<u8>, String> {
        let path = self.private_path(module_id, relative_path, false)?;
        read_bounded(&path)
    }

    pub fn write_private(
        &self,
        module_id: &str,
        relative_path: &str,
        data: &[u8],
    ) -> Result<usize, String> {
        if data.len() > MAX_FILE_BYTES {
            return Err("file_size_limit".into());
        }
        let path = self.private_path(module_id, relative_path, true)?;
        atomic_write(&path, data)?;
        Ok(data.len())
    }

    pub fn create_grant(
        &self,
        module_id: &str,
        path: &Path,
        kind: GrantKind,
        access: GrantAccess,
    ) -> Result<FileGrant, String> {
        validate_module_id(module_id)?;
        validate_grant_access(kind, access)?;
        let canonical =
            fs::canonicalize(path).map_err(|error| format!("resolve grant target: {error}"))?;
        let metadata =
            fs::metadata(&canonical).map_err(|error| format!("read grant target: {error}"))?;
        match kind {
            GrantKind::File | GrantKind::Executable if !metadata.is_file() => {
                return Err("grant target must be a file".into());
            }
            GrantKind::Directory if !metadata.is_dir() => {
                return Err("grant target must be a directory".into());
            }
            _ => {}
        }
        let display_name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("selected item")
            .to_owned();
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).map_err(|error| format!("generate file grant id: {error}"))?;
        let id: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let grant = FileGrant {
            id: id.clone(),
            module_id: module_id.to_owned(),
            display_name,
            kind,
            access,
            path: canonical,
        };
        let mut grants = self.load_grants()?;
        grants.grants.insert(id, grant.clone());
        self.save_grants(&grants)?;
        Ok(grant)
    }

    pub fn list_grants(&self, module_id: &str) -> Result<Vec<FileGrant>, String> {
        validate_module_id(module_id)?;
        Ok(self
            .load_grants()?
            .grants
            .into_values()
            .filter(|grant| grant.module_id == module_id)
            .collect())
    }

    pub fn revoke_grant(&self, module_id: &str, grant_id: &str) -> Result<(), String> {
        let mut grants = self.load_grants()?;
        let grant = grants.grants.get(grant_id).ok_or("unknown_grant")?;
        if grant.module_id != module_id {
            return Err("grant_owner_mismatch".into());
        }
        grants.grants.remove(grant_id);
        self.save_grants(&grants)
    }

    pub fn read_grant(&self, module_id: &str, grant_id: &str) -> Result<Vec<u8>, String> {
        let grant = self.require_grant(module_id, grant_id)?;
        if !grant.access.read || grant.kind != GrantKind::File {
            return Err("grant_read_denied".into());
        }
        read_bounded(&resolve_existing_grant_target(&grant)?)
    }

    pub fn write_grant(
        &self,
        module_id: &str,
        grant_id: &str,
        data: &[u8],
    ) -> Result<usize, String> {
        if data.len() > MAX_FILE_BYTES {
            return Err("file_size_limit".into());
        }
        let grant = self.require_grant(module_id, grant_id)?;
        if !grant.access.write || grant.kind != GrantKind::File {
            return Err("grant_write_denied".into());
        }
        let target = resolve_existing_grant_target(&grant)?;
        atomic_write(&target, data)?;
        Ok(data.len())
    }

    pub fn list_grant_directory(
        &self,
        module_id: &str,
        grant_id: &str,
    ) -> Result<Vec<DirectoryEntry>, String> {
        let grant = self.require_grant(module_id, grant_id)?;
        if !grant.access.list || grant.kind != GrantKind::Directory {
            return Err("grant_list_denied".into());
        }
        let target = resolve_existing_grant_target(&grant)?;
        let mut result = Vec::new();
        for entry in
            fs::read_dir(target).map_err(|error| format!("list grant directory: {error}"))?
        {
            if result.len() == MAX_DIRECTORY_ENTRIES {
                return Err("directory_entry_limit".into());
            }
            let entry = entry.map_err(|error| format!("list grant directory entry: {error}"))?;
            let metadata = entry
                .file_type()
                .map_err(|error| format!("inspect grant directory entry: {error}"))?;
            if metadata.is_symlink() {
                continue;
            }
            result.push(DirectoryEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                kind: if metadata.is_dir() {
                    GrantKind::Directory
                } else {
                    GrantKind::File
                },
            });
        }
        result.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(result)
    }

    pub fn resolve_executable(&self, module_id: &str, grant_id: &str) -> Result<PathBuf, String> {
        let grant = self.require_grant(module_id, grant_id)?;
        if grant.kind != GrantKind::Executable || !grant.access.execute {
            return Err("grant_execute_denied".into());
        }
        resolve_existing_grant_target(&grant)
    }

    pub fn resolve_readable_file(
        &self,
        module_id: &str,
        grant_id: &str,
    ) -> Result<PathBuf, String> {
        let grant = self.require_grant(module_id, grant_id)?;
        if grant.kind != GrantKind::File || !grant.access.read {
            return Err("grant_read_denied".into());
        }
        resolve_existing_grant_target(&grant)
    }

    fn require_grant(&self, module_id: &str, grant_id: &str) -> Result<FileGrant, String> {
        validate_module_id(module_id)?;
        let grants = self.load_grants()?;
        let grant = grants.grants.get(grant_id).ok_or("unknown_grant")?;
        if grant.module_id != module_id {
            return Err("grant_owner_mismatch".into());
        }
        Ok(grant.clone())
    }

    fn private_path(
        &self,
        module_id: &str,
        relative_path: &str,
        create_parent: bool,
    ) -> Result<PathBuf, String> {
        validate_module_id(module_id)?;
        let relative = safe_relative_path(relative_path)?;
        let root = self.private_root.join(module_id).join("files");
        fs::create_dir_all(&root)
            .map_err(|error| format!("create module private root: {error}"))?;
        let canonical_root = fs::canonicalize(&root)
            .map_err(|error| format!("resolve module private root: {error}"))?;
        let target = canonical_root.join(&relative);
        let parent = target.parent().ok_or("private file has no parent")?;
        if create_parent {
            create_safe_directories(&canonical_root, parent)?;
        }
        ensure_no_symlink_components(&canonical_root, &target)?;
        Ok(target)
    }

    fn load_grants(&self) -> Result<GrantFile, String> {
        match fs::read(&self.grants_path) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|error| format!("read file grants: {error}"))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(GrantFile::default()),
            Err(error) => Err(format!("read file grants: {error}")),
        }
    }

    fn save_grants(&self, grants: &GrantFile) -> Result<(), String> {
        let parent = self
            .grants_path
            .parent()
            .ok_or("grant store has no parent directory")?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("create grant store directory: {error}"))?;
        let mut temporary = NamedTempFile::new_in(parent)
            .map_err(|error| format!("create temporary grant store: {error}"))?;
        serde_json::to_writer_pretty(&mut temporary, grants)
            .map_err(|error| format!("serialize file grants: {error}"))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| format!("sync file grants: {error}"))?;
        temporary
            .persist(&self.grants_path)
            .map_err(|error| format!("persist file grants: {}", error.error))?;
        Ok(())
    }
}

fn validate_module_id(module_id: &str) -> Result<(), String> {
    if is_module_id(module_id) {
        Ok(())
    } else {
        Err(format!("invalid module id: {module_id}"))
    }
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.contains('\\') {
        return Err("unsafe_relative_path".into());
    }
    let path = Path::new(value);
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("unsafe_relative_path".into());
    }
    Ok(path.to_owned())
}

fn create_safe_directories(root: &Path, parent: &Path) -> Result<(), String> {
    let relative = parent
        .strip_prefix(root)
        .map_err(|_| "private_path_escape")?;
    let mut current = root.to_owned();
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err("private_path_escape".into());
        };
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("private_symlink_escape".into());
            }
            Ok(metadata) if !metadata.is_dir() => return Err("private_parent_not_directory".into()),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&current)
                .map_err(|error| format!("create private directory: {error}"))?,
            Err(error) => return Err(format!("inspect private directory: {error}")),
        }
    }
    Ok(())
}

fn ensure_no_symlink_components(root: &Path, target: &Path) -> Result<(), String> {
    let relative = target
        .strip_prefix(root)
        .map_err(|_| "private_path_escape")?;
    let mut current = root.to_owned();
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err("private_path_escape".into());
        };
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("private_symlink_escape".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(format!("inspect private path: {error}")),
        }
    }
    Ok(())
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("read file metadata: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES as u64 {
        return Err("file_size_limit".into());
    }
    let file = File::open(path).map_err(|error| format!("open file: {error}"))?;
    let mut result = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_FILE_BYTES + 1) as u64)
        .read_to_end(&mut result)
        .map_err(|error| format!("read file: {error}"))?;
    if result.len() > MAX_FILE_BYTES {
        return Err("file_size_limit".into());
    }
    Ok(result)
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("file target has no parent directory")?;
    let mut temporary =
        NamedTempFile::new_in(parent).map_err(|error| format!("create temporary file: {error}"))?;
    temporary
        .write_all(data)
        .map_err(|error| format!("write temporary file: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("sync temporary file: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("replace target file: {}", error.error))?;
    Ok(())
}

fn resolve_existing_grant_target(grant: &FileGrant) -> Result<PathBuf, String> {
    let canonical =
        fs::canonicalize(&grant.path).map_err(|error| format!("resolve grant target: {error}"))?;
    let metadata = fs::symlink_metadata(&grant.path)
        .map_err(|error| format!("inspect grant target: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("grant_target_is_symlink".into());
    }
    match grant.kind {
        GrantKind::File | GrantKind::Executable if !canonical.is_file() => {
            Err("grant target type changed".into())
        }
        GrantKind::Directory if !canonical.is_dir() => Err("grant target type changed".into()),
        _ => Ok(canonical),
    }
}

fn validate_grant_access(kind: GrantKind, access: GrantAccess) -> Result<(), String> {
    let valid = match kind {
        GrantKind::File => !access.execute && !access.list && (access.read || access.write),
        GrantKind::Directory => !access.execute && access.list,
        GrantKind::Executable => access.execute && !access.read && !access.write && !access.list,
    };
    if valid {
        Ok(())
    } else {
        Err("invalid_grant_access".into())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn isolates_private_files_rejects_escape_and_persists_content() {
        let temp = tempfile::tempdir().unwrap();
        let manager =
            FilesystemManager::new(temp.path().join("private"), temp.path().join("grants.json"));
        manager
            .write_private("alpha-module", "notes/item.txt", b"alpha")
            .unwrap();
        manager
            .write_private("beta-module", "notes/item.txt", b"beta")
            .unwrap();

        let reopened =
            FilesystemManager::new(temp.path().join("private"), temp.path().join("grants.json"));
        assert_eq!(
            reopened
                .read_private("alpha-module", "notes/item.txt")
                .unwrap(),
            b"alpha"
        );
        assert_eq!(
            reopened
                .read_private("beta-module", "notes/item.txt")
                .unwrap(),
            b"beta"
        );
        for value in [
            "../escape.txt",
            "C:/escape.txt",
            "/absolute.txt",
            "notes/../../escape.txt",
        ] {
            assert!(
                manager
                    .write_private("alpha-module", value, b"bad")
                    .is_err(),
                "accepted {value}"
            );
        }
        assert!(!temp.path().join("escape.txt").exists());
    }

    #[test]
    fn rejects_oversized_files_without_replacing_existing_content() {
        let temp = tempfile::tempdir().unwrap();
        let manager =
            FilesystemManager::new(temp.path().join("private"), temp.path().join("grants.json"));
        manager
            .write_private("alpha-module", "item.bin", b"original")
            .unwrap();
        assert!(
            manager
                .write_private("alpha-module", "item.bin", &vec![0; MAX_FILE_BYTES + 1])
                .is_err()
        );
        assert_eq!(
            manager.read_private("alpha-module", "item.bin").unwrap(),
            b"original"
        );
    }

    #[test]
    fn grants_are_module_owned_persistent_and_revocable() {
        let temp = tempfile::tempdir().unwrap();
        let external = temp.path().join("external.txt");
        fs::write(&external, b"shared").unwrap();
        let manager =
            FilesystemManager::new(temp.path().join("private"), temp.path().join("grants.json"));
        let grant = manager
            .create_grant(
                "alpha-module",
                &external,
                GrantKind::File,
                GrantAccess::read_write(),
            )
            .unwrap();
        assert_eq!(
            manager.read_grant("alpha-module", &grant.id).unwrap(),
            b"shared"
        );
        assert!(manager.read_grant("beta-module", &grant.id).is_err());

        let reopened =
            FilesystemManager::new(temp.path().join("private"), temp.path().join("grants.json"));
        reopened
            .write_grant("alpha-module", &grant.id, b"updated")
            .unwrap();
        assert_eq!(fs::read(&external).unwrap(), b"updated");
        reopened.revoke_grant("alpha-module", &grant.id).unwrap();
        assert!(reopened.read_grant("alpha-module", &grant.id).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_link_escape() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let manager =
            FilesystemManager::new(temp.path().join("private"), temp.path().join("grants.json"));
        manager
            .write_private("alpha-module", "inside.txt", b"inside")
            .unwrap();
        let root = temp.path().join("private/alpha-module/files");
        symlink(temp.path(), root.join("outside")).unwrap();
        assert!(
            manager
                .write_private("alpha-module", "outside/escape.txt", b"bad")
                .is_err()
        );
    }
}
