use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::PathBuf,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use crate::features::runtime_modules::manifest::{LocalizedText, is_module_id};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalFileAccess {
    Read,
    Write,
    List,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemCapability {
    #[serde(default)]
    pub private: bool,
    #[serde(default)]
    pub external: Vec<ExternalFileAccess>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessCapability {
    #[serde(default)]
    pub url_schemes: Vec<String>,
    #[serde(default)]
    pub executable_grants: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum RegistryHive {
    #[serde(rename = "HKCU")]
    CurrentUser,
    #[serde(rename = "HKLM")]
    LocalMachine,
}

impl RegistryHive {
    fn label(self) -> &'static str {
        match self {
            Self::CurrentUser => "HKCU",
            Self::LocalMachine => "HKLM",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum RegistryAccess {
    Read,
    ReadWrite,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct RegistryScope {
    pub hive: RegistryHive,
    pub key: String,
    pub access: RegistryAccess,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum TrayItemKind {
    Button,
    Check,
    Separator,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct TrayItemDeclaration {
    pub id: String,
    pub label: Option<LocalizedText>,
    pub kind: TrayItemKind,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct ShortcutDeclaration {
    pub id: String,
    pub description: LocalizedText,
    pub accelerator: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModuleRepositoryCapability {
    pub install: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationsCapability {
    #[serde(default)]
    pub system: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardCapability {
    #[serde(default)]
    pub text: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpCapability {
    #[serde(default)]
    pub origins: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeCapabilities {
    pub filesystem: Option<FilesystemCapability>,
    pub process: Option<ProcessCapability>,
    #[serde(default)]
    pub registry: Vec<RegistryScope>,
    #[serde(default)]
    pub tray: Vec<TrayItemDeclaration>,
    #[serde(default)]
    pub shortcuts: Vec<ShortcutDeclaration>,
    pub module_repository: Option<ModuleRepositoryCapability>,
    pub notifications: Option<NotificationsCapability>,
    pub clipboard: Option<ClipboardCapability>,
    pub http: Option<HttpCapability>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedNativeCapabilities {
    pub filesystem: Option<FilesystemCapability>,
    pub process: Option<ProcessCapability>,
    pub registry: Vec<RegistryScope>,
    pub tray: Vec<TrayItemDeclaration>,
    pub shortcuts: Vec<ShortcutDeclaration>,
    pub module_repository: Option<ModuleRepositoryCapability>,
    pub notifications: Option<NotificationsCapability>,
    pub clipboard: Option<ClipboardCapability>,
    pub http: Option<HttpCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NativePermissionSummary {
    PrivateFilesystem,
    ExternalFilesystem {
        access: Vec<String>,
    },
    UrlSchemes {
        schemes: Vec<String>,
    },
    ExecutableGrants,
    Registry {
        hive: String,
        key: String,
        access: String,
    },
    Tray {
        count: usize,
    },
    Shortcuts {
        count: usize,
    },
    ModuleRepositoryInstall,
    Notifications,
    Clipboard,
    Http { origins: Vec<String> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeCapabilityKind {
    Filesystem,
    Process,
    Registry,
    Tray,
    Shortcuts,
    ModuleRepository,
    Notifications,
    Clipboard,
    Http,
}

impl NativeCapabilities {
    pub fn normalize(&self) -> Result<NormalizedNativeCapabilities, String> {
        let filesystem = self.filesystem.clone().map(|mut value| {
            value.external.sort();
            value.external.dedup();
            value
        });

        let process = self
            .process
            .clone()
            .map(|mut value| {
                for scheme in &mut value.url_schemes {
                    *scheme = scheme.to_ascii_lowercase();
                    validate_scheme(scheme)?;
                }
                value.url_schemes.sort();
                value.url_schemes.dedup();
                Ok::<_, String>(value)
            })
            .transpose()?;

        let mut registry = self.registry.clone();
        for scope in &mut registry {
            scope.key = normalize_registry_key(&scope.key)?;
            if scope.hive == RegistryHive::LocalMachine && scope.access == RegistryAccess::ReadWrite
            {
                return Err("HKLM scopes are read-only".into());
            }
        }
        registry.sort();
        if registry.windows(2).any(|items| items[0] == items[1]) {
            return Err("duplicate registry scope".into());
        }

        let mut tray = self.tray.clone();
        validate_unique_contributions(tray.iter().map(|item| item.id.as_str()), "tray")?;
        for item in &tray {
            if item.kind == TrayItemKind::Separator {
                if item.label.is_some() {
                    return Err("tray separator label must be omitted".into());
                }
            } else {
                item.label
                    .as_ref()
                    .ok_or("tray item label must contain zh-CN and en")?
                    .validate("tray label", 120)?;
            }
        }
        tray.sort_by(|left, right| (left.order, &left.id).cmp(&(right.order, &right.id)));

        let mut shortcuts = self.shortcuts.clone();
        validate_unique_contributions(shortcuts.iter().map(|item| item.id.as_str()), "shortcut")?;
        for item in &shortcuts {
            item.description.validate("shortcut description", 200)?;
            validate_accelerator(&item.accelerator)?;
        }
        shortcuts.sort_by(|left, right| left.id.cmp(&right.id));

        if self
            .module_repository
            .as_ref()
            .is_some_and(|capability| !capability.install)
        {
            return Err("module repository capability must request install access".into());
        }

        if let Some(notifications) = &self.notifications
            && !notifications.system
        {
            return Err("notifications capability must request system access".into());
        }

        if let Some(clipboard) = &self.clipboard
            && !clipboard.text
        {
            return Err("clipboard capability must request text access".into());
        }

        let http = self.http.clone().map(|mut value| -> Result<HttpCapability, String> {
            for origin in &mut value.origins {
                if !origin.starts_with("https://") {
                    return Err(format!("http origin must be https: {origin}"));
                }
            }
            value.origins.sort();
            value.origins.dedup();
            Ok(value)
        }).transpose()?;

        Ok(NormalizedNativeCapabilities {
            filesystem,
            process,
            registry,
            tray,
            shortcuts,
            module_repository: self.module_repository.clone(),
            notifications: self.notifications.clone(),
            clipboard: self.clipboard.clone(),
            http,
        })
    }
}

impl NormalizedNativeCapabilities {
    pub fn fingerprint(&self) -> String {
        let encoded = serde_json::to_vec(self).expect("normalized permissions must serialize");
        let digest = Sha256::digest(encoded);
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    pub fn summary(&self) -> Vec<NativePermissionSummary> {
        let mut result = Vec::new();
        if let Some(filesystem) = &self.filesystem {
            if filesystem.private {
                result.push(NativePermissionSummary::PrivateFilesystem);
            }
            if !filesystem.external.is_empty() {
                result.push(NativePermissionSummary::ExternalFilesystem {
                    access: filesystem
                        .external
                        .iter()
                        .map(|value| format!("{value:?}").to_ascii_lowercase())
                        .collect(),
                });
            }
        }
        if let Some(process) = &self.process {
            if !process.url_schemes.is_empty() {
                result.push(NativePermissionSummary::UrlSchemes {
                    schemes: process.url_schemes.clone(),
                });
            }
            if process.executable_grants {
                result.push(NativePermissionSummary::ExecutableGrants);
            }
        }
        result.extend(self.registry.iter().map(|scope| {
            NativePermissionSummary::Registry {
                hive: scope.hive.label().into(),
                key: scope.key.clone(),
                access: match scope.access {
                    RegistryAccess::Read => "read",
                    RegistryAccess::ReadWrite => "read_write",
                }
                .into(),
            }
        }));
        if !self.tray.is_empty() {
            result.push(NativePermissionSummary::Tray {
                count: self.tray.len(),
            });
        }
        if !self.shortcuts.is_empty() {
            result.push(NativePermissionSummary::Shortcuts {
                count: self.shortcuts.len(),
            });
        }
        if self.module_repository.is_some() {
            result.push(NativePermissionSummary::ModuleRepositoryInstall);
        }
        if let Some(notifications) = &self.notifications
            && notifications.system
        {
            result.push(NativePermissionSummary::Notifications);
        }
        if let Some(clipboard) = &self.clipboard
            && clipboard.text
        {
            result.push(NativePermissionSummary::Clipboard);
        }
        if let Some(http) = &self.http
            && !http.origins.is_empty()
        {
            result.push(NativePermissionSummary::Http {
                origins: http.origins.clone(),
            });
        }
        result
    }

    pub fn has_kind(&self, kind: NativeCapabilityKind) -> bool {
        match kind {
            NativeCapabilityKind::Filesystem => self.filesystem.is_some(),
            NativeCapabilityKind::Process => self.process.is_some(),
            NativeCapabilityKind::Registry => !self.registry.is_empty(),
            NativeCapabilityKind::Tray => !self.tray.is_empty(),
            NativeCapabilityKind::Shortcuts => !self.shortcuts.is_empty(),
            NativeCapabilityKind::ModuleRepository => self.module_repository.is_some(),
            NativeCapabilityKind::Notifications => self
                .notifications
                .as_ref()
                .is_some_and(|value| value.system),
            NativeCapabilityKind::Clipboard => self
                .clipboard
                .as_ref()
                .is_some_and(|value| value.text),
            NativeCapabilityKind::Http => self.http.is_some(),
        }
    }

    pub fn is_subset_of(&self, approved: &Self) -> bool {
        filesystem_subset(self.filesystem.as_ref(), approved.filesystem.as_ref())
            && process_subset(self.process.as_ref(), approved.process.as_ref())
            && self
                .registry
                .iter()
                .all(|scope| registry_scope_covered(scope, &approved.registry))
            && self.tray.iter().all(|item| approved.tray.contains(item))
            && self
                .shortcuts
                .iter()
                .all(|item| approved.shortcuts.contains(item))
            && (self.module_repository.is_none() || approved.module_repository.is_some())
            && notifications_subset(self.notifications.as_ref(), approved.notifications.as_ref())
            && clipboard_subset(self.clipboard.as_ref(), approved.clipboard.as_ref())
            && http_subset(self.http.as_ref(), approved.http.as_ref())
    }
}

fn notifications_subset(
    requested: Option<&NotificationsCapability>,
    approved: Option<&NotificationsCapability>,
) -> bool {
    match (requested, approved) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(requested), Some(approved)) => !requested.system || approved.system,
    }
}

fn clipboard_subset(
    requested: Option<&ClipboardCapability>,
    approved: Option<&ClipboardCapability>,
) -> bool {
    match (requested, approved) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(requested), Some(approved)) => !requested.text || approved.text,
    }
}

fn http_subset(
    requested: Option<&HttpCapability>,
    approved: Option<&HttpCapability>,
) -> bool {
    match (requested, approved) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(requested), Some(approved)) => requested
            .origins
            .iter()
            .all(|origin| approved.origins.contains(origin)),
    }
}

fn filesystem_subset(
    requested: Option<&FilesystemCapability>,
    approved: Option<&FilesystemCapability>,
) -> bool {
    match (requested, approved) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(requested), Some(approved)) => {
            (!requested.private || approved.private)
                && requested
                    .external
                    .iter()
                    .all(|access| approved.external.contains(access))
        }
    }
}

fn process_subset(
    requested: Option<&ProcessCapability>,
    approved: Option<&ProcessCapability>,
) -> bool {
    match (requested, approved) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(requested), Some(approved)) => {
            (!requested.executable_grants || approved.executable_grants)
                && requested
                    .url_schemes
                    .iter()
                    .all(|scheme| approved.url_schemes.contains(scheme))
        }
    }
}

fn registry_scope_covered(requested: &RegistryScope, approved: &[RegistryScope]) -> bool {
    approved.iter().any(|scope| {
        let requested_key = requested.key.to_ascii_lowercase();
        let approved_key = scope.key.to_ascii_lowercase();
        scope.hive == requested.hive
            && (scope.access == RegistryAccess::ReadWrite
                || requested.access == RegistryAccess::Read)
            && (requested_key == approved_key
                || requested_key.starts_with(&format!("{approved_key}\\")))
    })
}

fn validate_scheme(value: &str) -> Result<(), String> {
    let valid = (1..=32).contains(&value.len())
        && value.chars().enumerate().all(|(index, character)| {
            character.is_ascii_lowercase()
                || (index > 0
                    && (character.is_ascii_digit() || matches!(character, '+' | '-' | '.')))
        });
    if !valid
        || matches!(
            value,
            "file" | "javascript" | "data" | "shell" | "powershell" | "cmd"
        )
    {
        return Err(format!("invalid or unsafe URL scheme: {value}"));
    }
    Ok(())
}

pub fn normalize_registry_key(value: &str) -> Result<String, String> {
    let segments: Vec<_> = value.split(['\\', '/']).collect();
    if segments.is_empty()
        || segments.iter().any(|segment| {
            segment.is_empty()
                || matches!(*segment, "." | "..")
                || segment.chars().any(char::is_control)
        })
    {
        return Err(format!("invalid registry key: {value}"));
    }
    Ok(segments.join("\\"))
}

fn validate_unique_contributions<'a>(
    values: impl Iterator<Item = &'a str>,
    label: &str,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    for value in values {
        if !is_contribution_id(value) || !seen.insert(value) {
            return Err(format!("invalid or duplicate {label} id: {value}"));
        }
    }
    Ok(())
}

fn is_contribution_id(value: &str) -> bool {
    (2..=64).contains(&value.len())
        && value.chars().enumerate().all(|(index, character)| {
            character.is_ascii_alphabetic()
                || (index > 0
                    && (character.is_ascii_digit() || matches!(character, '.' | '_' | '-')))
        })
}

fn validate_accelerator(value: &str) -> Result<(), String> {
    if value.len() > 64 || !value.contains('+') || value.chars().any(char::is_control) {
        return Err(format!("invalid shortcut accelerator: {value}"));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionDecision {
    Approved,
    AwaitingApproval,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalRecord {
    fingerprint: String,
    permissions: NormalizedNativeCapabilities,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ApprovalFile {
    modules: BTreeMap<String, ApprovalRecord>,
}

#[derive(Debug, Clone)]
pub struct PermissionStore {
    path: PathBuf,
}

impl PermissionStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn decision(
        &self,
        module_id: &str,
        requested: &NormalizedNativeCapabilities,
    ) -> Result<PermissionDecision, String> {
        validate_module_id(module_id)?;
        let approvals = self.load()?;
        Ok(match approvals.modules.get(module_id) {
            Some(record) if requested.is_subset_of(&record.permissions) => {
                PermissionDecision::Approved
            }
            _ => PermissionDecision::AwaitingApproval,
        })
    }

    pub fn approve(
        &self,
        module_id: &str,
        permissions: &NormalizedNativeCapabilities,
    ) -> Result<(), String> {
        validate_module_id(module_id)?;
        let mut approvals = self.load()?;
        approvals.modules.insert(
            module_id.to_owned(),
            ApprovalRecord {
                fingerprint: permissions.fingerprint(),
                permissions: permissions.clone(),
            },
        );
        self.save(&approvals)
    }

    pub fn revoke(&self, module_id: &str) -> Result<(), String> {
        validate_module_id(module_id)?;
        let mut approvals = self.load()?;
        approvals.modules.remove(module_id);
        self.save(&approvals)
    }

    fn load(&self) -> Result<ApprovalFile, String> {
        match fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| format!("read native permission approvals: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(ApprovalFile::default())
            }
            Err(error) => Err(format!("read native permission approvals: {error}")),
        }
    }

    fn save(&self, approvals: &ApprovalFile) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or("permission store has no parent directory")?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("create permission directory: {error}"))?;
        let mut temporary = NamedTempFile::new_in(parent)
            .map_err(|error| format!("create temporary permission file: {error}"))?;
        serde_json::to_writer_pretty(&mut temporary, approvals)
            .map_err(|error| format!("serialize native permissions: {error}"))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| format!("sync native permissions: {error}"))?;
        temporary
            .persist(&self.path)
            .map_err(|error| format!("persist native permissions: {}", error.error))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn text(zh_cn: &str, en: &str) -> LocalizedText {
        LocalizedText {
            zh_cn: zh_cn.into(),
            en: en.into(),
        }
    }

    fn capabilities() -> NativeCapabilities {
        NativeCapabilities {
            filesystem: Some(FilesystemCapability {
                private: true,
                external: vec![ExternalFileAccess::Read, ExternalFileAccess::Write],
            }),
            process: Some(ProcessCapability {
                url_schemes: vec!["https".into(), "steam".into()],
                executable_grants: true,
            }),
            registry: vec![RegistryScope {
                hive: RegistryHive::CurrentUser,
                key: "Software\\Example".into(),
                access: RegistryAccess::ReadWrite,
            }],
            tray: vec![TrayItemDeclaration {
                id: "open-main".into(),
                label: Some(text("打开", "Open")),
                kind: TrayItemKind::Button,
                order: 10,
            }],
            shortcuts: vec![ShortcutDeclaration {
                id: "show-main".into(),
                description: text("显示主窗口", "Show main window"),
                accelerator: "Ctrl+Shift+M".into(),
            }],
            module_repository: None,
            notifications: None,
            clipboard: None,
            http: None,
        }
    }

    #[test]
    fn normalizes_declarations_and_generates_stable_fingerprint() {
        let first = capabilities().normalize().unwrap();
        let mut reordered = capabilities();
        reordered.process.as_mut().unwrap().url_schemes.reverse();
        reordered.filesystem.as_mut().unwrap().external.reverse();
        let second = reordered.normalize().unwrap();

        assert_eq!(first, second);
        assert_eq!(first.fingerprint(), second.fingerprint());
        assert!(first.summary().iter().any(|item| matches!(
            item,
            NativePermissionSummary::Registry { hive, .. } if hive == "HKCU"
        )));
    }

    #[test]
    fn rejects_dangerous_registry_and_process_declarations() {
        let mut hklm_write = capabilities();
        hklm_write.registry[0] = RegistryScope {
            hive: RegistryHive::LocalMachine,
            key: "Software\\Example".into(),
            access: RegistryAccess::ReadWrite,
        };
        assert!(hklm_write.normalize().unwrap_err().contains("HKLM"));

        let mut unsafe_scheme = capabilities();
        unsafe_scheme.process.as_mut().unwrap().url_schemes = vec!["powershell -Command".into()];
        assert!(unsafe_scheme.normalize().unwrap_err().contains("scheme"));
    }

    #[test]
    fn permission_store_requires_approval_for_expansion_and_reuses_narrower_grants() {
        let temp = tempfile::tempdir().unwrap();
        let store = PermissionStore::new(temp.path().join("permissions.json"));
        let full = capabilities().normalize().unwrap();
        assert_eq!(
            store.decision("sample-module", &full).unwrap(),
            PermissionDecision::AwaitingApproval
        );

        store.approve("sample-module", &full).unwrap();
        assert_eq!(
            store.decision("sample-module", &full).unwrap(),
            PermissionDecision::Approved
        );

        let mut narrower = capabilities();
        narrower.filesystem.as_mut().unwrap().external = vec![ExternalFileAccess::Read];
        narrower.process.as_mut().unwrap().url_schemes = vec!["https".into()];
        let narrower = narrower.normalize().unwrap();
        assert_eq!(
            store.decision("sample-module", &narrower).unwrap(),
            PermissionDecision::Approved
        );

        let mut wider = capabilities();
        wider
            .process
            .as_mut()
            .unwrap()
            .url_schemes
            .push("mailto".into());
        let wider = wider.normalize().unwrap();
        assert_eq!(
            store.decision("sample-module", &wider).unwrap(),
            PermissionDecision::AwaitingApproval
        );

        store.revoke("sample-module").unwrap();
        assert_eq!(
            store.decision("sample-module", &full).unwrap(),
            PermissionDecision::AwaitingApproval
        );
    }

    #[test]
    fn module_repository_install_changes_fingerprint_and_permission_summary() {
        let base = capabilities().normalize().unwrap();
        let mut requested = capabilities();
        requested.module_repository = Some(ModuleRepositoryCapability { install: true });
        let requested = requested.normalize().unwrap();

        assert_ne!(base.fingerprint(), requested.fingerprint());
        assert!(
            requested
                .summary()
                .contains(&NativePermissionSummary::ModuleRepositoryInstall)
        );
        assert!(!requested.is_subset_of(&base));
        assert!(base.is_subset_of(&requested));
    }

    #[test]
    fn notifications_capability_changes_fingerprint_and_requires_approval() {
        let base = capabilities().normalize().unwrap();
        let mut requested = capabilities();
        requested.notifications = Some(NotificationsCapability { system: true });
        let requested = requested.normalize().unwrap();

        assert_ne!(base.fingerprint(), requested.fingerprint());
        assert!(requested.summary().contains(&NativePermissionSummary::Notifications));
        assert!(!requested.is_subset_of(&base));
        assert!(base.is_subset_of(&requested));

        let mut invalid = capabilities();
        invalid.notifications = Some(NotificationsCapability { system: false });
        assert!(invalid.normalize().unwrap_err().contains("notifications"));
    }
}
