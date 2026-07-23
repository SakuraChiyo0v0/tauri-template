use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use semver::Version;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{
    manifest::RuntimeModuleManifest,
    resolver::{ResolveRequest, resolve},
    store::{ModuleStore, RuntimeModuleOperationResult},
    types::{RuntimeModuleDiagnostic, RuntimeModuleStatus},
};
use crate::features::native_capabilities::permissions::NativePermissionSummary;

const MAX_REPOSITORY_ENTRIES: usize = 1_000;
const MAX_PLAN_AGE: Duration = Duration::from_secs(5 * 60);
const MAX_RESOLUTION_NODES: usize = 50_000;

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

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryPlanAction {
    Keep,
    Install,
    Upgrade,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPlanDiagnostic {
    pub code: String,
    pub module_id: String,
    pub dependency_id: Option<String>,
    pub required_version: Option<String>,
    pub available_versions: Vec<String>,
    pub related_modules: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInstallPlanEntry {
    pub module_id: String,
    pub name: super::manifest::LocalizedText,
    pub version: String,
    pub current_version: Option<String>,
    pub action: RepositoryPlanAction,
    pub required_dependencies: Vec<super::manifest::RuntimeModuleDependency>,
    pub permission_summary: Vec<NativePermissionSummary>,
    pub requires_permission_approval: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInstallPlan {
    pub plan_id: String,
    pub target_module_id: String,
    pub target_version: String,
    pub executable: bool,
    pub entries: Vec<RepositoryInstallPlanEntry>,
    pub activation_order: Vec<String>,
    pub diagnostics: Vec<RepositoryPlanDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPlanInstalledModule {
    pub module_id: String,
    pub version: String,
    pub status: RuntimeModuleStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInstallPlanResult {
    pub target_module_id: String,
    pub plan_changed: bool,
    pub modules: Vec<RepositoryPlanInstalledModule>,
}

#[derive(Debug, Clone)]
struct RepositoryCandidate {
    file_name: String,
    sha256: String,
    manifest: RuntimeModuleManifest,
}

#[derive(Debug, Clone)]
pub struct PreparedRepositoryPlan {
    target_file_name: String,
    target_module_id: String,
    target_version: String,
    baseline_generation: u64,
    fingerprint: String,
    package_files: Vec<String>,
    entries: Vec<RepositoryInstallPlanEntry>,
    activation_order: Vec<String>,
    diagnostics: Vec<RepositoryPlanDiagnostic>,
    executable: bool,
}

impl PreparedRepositoryPlan {
    fn public(&self, plan_id: String) -> RepositoryInstallPlan {
        RepositoryInstallPlan {
            plan_id,
            target_module_id: self.target_module_id.clone(),
            target_version: self.target_version.clone(),
            executable: self.executable,
            entries: self.entries.clone(),
            activation_order: self.activation_order.clone(),
            diagnostics: self.diagnostics.clone(),
        }
    }
}

#[derive(Debug, Clone)]
struct StoredRepositoryPlan {
    session_token: String,
    module_id: String,
    grant_id: String,
    created_at: Instant,
    plan: PreparedRepositoryPlan,
}

#[derive(Default)]
pub struct RepositoryPlanRegistry {
    plans: Mutex<BTreeMap<String, StoredRepositoryPlan>>,
}

impl RepositoryPlanRegistry {
    pub fn insert(
        &self,
        session_token: &str,
        module_id: &str,
        grant_id: &str,
        plan: PreparedRepositoryPlan,
    ) -> Result<RepositoryInstallPlan, String> {
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random)
            .map_err(|error| format!("generate repository plan id: {error}"))?;
        let plan_id = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        self.prune()?;
        self.plans
            .lock()
            .map_err(|_| "repository plan lock poisoned")?
            .insert(
                plan_id.clone(),
                StoredRepositoryPlan {
                    session_token: session_token.into(),
                    module_id: module_id.into(),
                    grant_id: grant_id.into(),
                    created_at: Instant::now(),
                    plan: plan.clone(),
                },
            );
        Ok(plan.public(plan_id))
    }

    pub fn consume(
        &self,
        session_token: &str,
        module_id: &str,
        grant_id: &str,
        plan_id: &str,
    ) -> Result<PreparedRepositoryPlan, String> {
        self.prune()?;
        let stored = self
            .plans
            .lock()
            .map_err(|_| "repository plan lock poisoned")?
            .remove(plan_id)
            .ok_or("stale_plan")?;
        if stored.session_token != session_token
            || stored.module_id != module_id
            || stored.grant_id != grant_id
        {
            return Err("permission_denied".into());
        }
        Ok(stored.plan)
    }

    pub fn revoke_session(&self, session_token: &str) {
        if let Ok(mut plans) = self.plans.lock() {
            plans.retain(|_, plan| plan.session_token != session_token);
        }
    }

    pub fn revoke_module(&self, module_id: &str) {
        if let Ok(mut plans) = self.plans.lock() {
            plans.retain(|_, plan| plan.module_id != module_id);
        }
    }

    fn prune(&self) -> Result<(), String> {
        self.plans
            .lock()
            .map_err(|_| "repository plan lock poisoned")?
            .retain(|_, plan| plan.created_at.elapsed() <= MAX_PLAN_AGE);
        Ok(())
    }
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

pub fn preview_repository_install(
    store: &ModuleStore,
    repository: &Path,
    file_name: &str,
) -> Result<PreparedRepositoryPlan, String> {
    let repository = canonical_repository(repository)?;
    let target_path = repository_package_path(&repository, file_name)?;
    let target_manifest = store.inspect_package(&target_path)?;
    let snapshot = store.snapshot(&[])?;
    let installed_catalog = store.repository_planning_catalog()?;
    let candidates = repository_candidates(store, &repository)?;
    let repository_conflicts = repository_conflicts(&candidates);
    let mut diagnostics = Vec::new();

    if !candidates
        .iter()
        .any(|candidate| candidate.file_name == file_name)
    {
        return Err("target_package_not_found".into());
    }
    let mut catalog = installed_catalog.clone();
    for candidate in &candidates {
        let manifests = catalog.entry(candidate.manifest.id.clone()).or_default();
        if !manifests.iter().any(|manifest| {
            manifest.version == candidate.manifest.version && manifest == &candidate.manifest
        }) {
            manifests.push(candidate.manifest.clone());
        }
    }

    let roots = snapshot
        .plan
        .desired_enabled
        .iter()
        .filter(|(_, enabled)| **enabled)
        .map(|(id, _)| id.clone())
        .chain(std::iter::once(target_manifest.id.clone()))
        .collect::<BTreeSet<_>>();
    let mut desired = required_union(&catalog, roots.clone());
    let mut resolved = resolve(&ResolveRequest {
        catalog: catalog.clone(),
        desired_enabled: desired.clone(),
        current_selected: snapshot.plan.selected_versions.clone(),
        preferred: Some((target_manifest.id.clone(), target_manifest.version.clone())),
        max_search_nodes: MAX_RESOLUTION_NODES,
    });

    if resolved.selected_versions.get(&target_manifest.id) == Some(&target_manifest.version) {
        loop {
            let reachable =
                selected_required_closure(&catalog, &resolved.selected_versions, &roots);
            if reachable == desired {
                break;
            }
            desired = reachable;
            resolved = resolve(&ResolveRequest {
                catalog: catalog.clone(),
                desired_enabled: desired.clone(),
                current_selected: snapshot.plan.selected_versions.clone(),
                preferred: Some((target_manifest.id.clone(), target_manifest.version.clone())),
                max_search_nodes: MAX_RESOLUTION_NODES,
            });
        }
    }

    diagnostics.extend(resolver_diagnostics(&resolved.diagnostics));
    if resolved.selected_versions.get(&target_manifest.id) != Some(&target_manifest.version) {
        diagnostics.push(RepositoryPlanDiagnostic {
            code: "target_unresolved".into(),
            module_id: target_manifest.id.clone(),
            dependency_id: None,
            required_version: Some(target_manifest.version.clone()),
            available_versions: catalog
                .get(&target_manifest.id)
                .into_iter()
                .flatten()
                .map(|manifest| manifest.version.clone())
                .collect(),
            related_modules: Vec::new(),
        });
    }

    for (id, current) in &snapshot.plan.selected_versions {
        let Some(selected) = resolved.selected_versions.get(id) else {
            continue;
        };
        if matches!((Version::parse(selected), Version::parse(current)), (Ok(next), Ok(previous)) if next < previous)
        {
            diagnostics.push(RepositoryPlanDiagnostic {
                code: "automatic_downgrade".into(),
                module_id: id.clone(),
                dependency_id: None,
                required_version: Some(selected.clone()),
                available_versions: vec![current.clone()],
                related_modules: Vec::new(),
            });
        }
    }

    let target_closure = selected_required_closure(
        &catalog,
        &resolved.selected_versions,
        &BTreeSet::from([target_manifest.id.clone()]),
    );
    diagnostics.extend(
        repository_conflicts
            .into_iter()
            .filter(|diagnostic| target_closure.contains(&diagnostic.module_id)),
    );
    let installed_versions = installed_catalog
        .iter()
        .map(|(id, manifests)| {
            (
                id.clone(),
                manifests
                    .iter()
                    .map(|manifest| manifest.version.clone())
                    .collect::<BTreeSet<_>>(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut entries = Vec::new();
    let mut package_files = Vec::new();
    for id in &resolved.activation_order {
        if !target_closure.contains(id) {
            continue;
        }
        let Some(version) = resolved.selected_versions.get(id) else {
            continue;
        };
        let manifest = catalog
            .get(id)
            .and_then(|manifests| {
                manifests
                    .iter()
                    .find(|manifest| &manifest.version == version)
            })
            .ok_or("planned_manifest_missing")?;
        let installed = installed_versions
            .get(id)
            .is_some_and(|versions| versions.contains(version));
        let current_version = snapshot.plan.selected_versions.get(id).cloned();
        let action = if installed {
            RepositoryPlanAction::Keep
        } else if current_version.is_some() {
            RepositoryPlanAction::Upgrade
        } else {
            RepositoryPlanAction::Install
        };
        if !installed {
            let candidate = candidates
                .iter()
                .filter(|candidate| {
                    candidate.manifest.id == *id && candidate.manifest.version == *version
                })
                .min_by(|left, right| left.file_name.cmp(&right.file_name))
                .ok_or("repository_dependency_package_missing")?;
            package_files.push(candidate.file_name.clone());
        }
        let permission_summary = manifest.normalized_native_capabilities()?.summary();
        entries.push(RepositoryInstallPlanEntry {
            module_id: id.clone(),
            name: manifest.name.clone(),
            version: version.clone(),
            current_version,
            action,
            required_dependencies: manifest.dependencies.required.clone(),
            requires_permission_approval: store.repository_permission_waiting(manifest)?,
            permission_summary,
        });
    }

    if package_files.is_empty() {
        diagnostics.push(RepositoryPlanDiagnostic {
            code: "already_installed".into(),
            module_id: target_manifest.id.clone(),
            dependency_id: None,
            required_version: Some(target_manifest.version.clone()),
            available_versions: Vec::new(),
            related_modules: Vec::new(),
        });
    }
    diagnostics.sort_by(|left, right| {
        left.module_id
            .cmp(&right.module_id)
            .then_with(|| left.code.cmp(&right.code))
            .then_with(|| left.dependency_id.cmp(&right.dependency_id))
    });
    diagnostics.dedup();
    package_files.sort_by_key(|file| {
        entries
            .iter()
            .position(|entry| {
                candidates.iter().any(|candidate| {
                    &candidate.file_name == file
                        && candidate.manifest.id == entry.module_id
                        && candidate.manifest.version == entry.version
                })
            })
            .unwrap_or(usize::MAX)
    });

    let fingerprint = plan_fingerprint(
        snapshot.plan.generation,
        file_name,
        &candidates,
        &resolved.selected_versions,
    );
    Ok(PreparedRepositoryPlan {
        target_file_name: file_name.into(),
        target_module_id: target_manifest.id,
        target_version: target_manifest.version,
        baseline_generation: snapshot.plan.generation,
        fingerprint,
        package_files,
        entries,
        activation_order: resolved.activation_order,
        executable: diagnostics.is_empty(),
        diagnostics,
    })
}

pub fn execute_repository_plan(
    store: &ModuleStore,
    repository: &Path,
    prepared: &PreparedRepositoryPlan,
) -> Result<RepositoryInstallPlanResult, String> {
    let refreshed = preview_repository_install(store, repository, &prepared.target_file_name)
        .map_err(|_| "stale_plan".to_owned())?;
    if refreshed.baseline_generation != prepared.baseline_generation
        || refreshed.fingerprint != prepared.fingerprint
        || !prepared.executable
    {
        return Err("stale_plan".into());
    }
    let repository = canonical_repository(repository)?;
    let paths = prepared
        .package_files
        .iter()
        .map(|file_name| repository_package_path(&repository, file_name))
        .collect::<Result<Vec<_>, _>>()?;
    let operation = store.install_batch_with_plan(
        &paths,
        &prepared.target_module_id,
        &prepared.target_version,
        prepared.baseline_generation,
    )?;
    let modules = prepared
        .entries
        .iter()
        .filter_map(|entry| {
            operation
                .modules
                .iter()
                .find(|module| module.manifest.id == entry.module_id)
                .map(|module| RepositoryPlanInstalledModule {
                    module_id: entry.module_id.clone(),
                    version: entry.version.clone(),
                    status: module.status,
                })
        })
        .collect();
    Ok(RepositoryInstallPlanResult {
        target_module_id: prepared.target_module_id.clone(),
        plan_changed: operation.plan_changed,
        modules,
    })
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

fn repository_candidates(
    store: &ModuleStore,
    repository: &Path,
) -> Result<Vec<RepositoryCandidate>, String> {
    let mut candidates = Vec::new();
    for entry in fs::read_dir(repository).map_err(io_error("read module repository"))? {
        if candidates.len() == MAX_REPOSITORY_ENTRIES {
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
        let path = repository_package_path(repository, &file_name)?;
        let manifest = match store.inspect_package(&path) {
            Ok(manifest) => manifest,
            Err(_) => continue,
        };
        let bytes = fs::read(&path).map_err(io_error("read repository package"))?;
        candidates.push(RepositoryCandidate {
            file_name,
            sha256: format!("{:x}", Sha256::digest(bytes)),
            manifest,
        });
    }
    candidates.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(candidates)
}

fn repository_conflicts(candidates: &[RepositoryCandidate]) -> Vec<RepositoryPlanDiagnostic> {
    let mut versions = BTreeMap::<(String, String), (&str, &str)>::new();
    let mut diagnostics = Vec::new();
    for candidate in candidates {
        let key = (
            candidate.manifest.id.clone(),
            candidate.manifest.version.clone(),
        );
        if let Some((sha256, file_name)) = versions.get(&key) {
            if *sha256 != candidate.sha256 {
                diagnostics.push(RepositoryPlanDiagnostic {
                    code: "repository_content_conflict".into(),
                    module_id: key.0,
                    dependency_id: None,
                    required_version: Some(key.1),
                    available_versions: Vec::new(),
                    related_modules: vec![(*file_name).into(), candidate.file_name.clone()],
                });
            }
        } else {
            versions.insert(key, (&candidate.sha256, &candidate.file_name));
        }
    }
    diagnostics
}

fn required_union(
    catalog: &BTreeMap<String, Vec<RuntimeModuleManifest>>,
    mut desired: BTreeSet<String>,
) -> BTreeSet<String> {
    loop {
        let mut changed = false;
        for id in desired.clone() {
            for manifest in catalog.get(&id).into_iter().flatten() {
                for dependency in &manifest.dependencies.required {
                    changed |= desired.insert(dependency.id.clone());
                }
            }
        }
        if !changed {
            return desired;
        }
    }
}

fn selected_required_closure(
    catalog: &BTreeMap<String, Vec<RuntimeModuleManifest>>,
    selected: &BTreeMap<String, String>,
    roots: &BTreeSet<String>,
) -> BTreeSet<String> {
    let mut closure = roots.clone();
    loop {
        let mut changed = false;
        for id in closure.clone() {
            let Some(version) = selected.get(&id) else {
                continue;
            };
            let Some(manifest) = catalog.get(&id).and_then(|manifests| {
                manifests
                    .iter()
                    .find(|manifest| &manifest.version == version)
            }) else {
                continue;
            };
            for dependency in &manifest.dependencies.required {
                changed |= closure.insert(dependency.id.clone());
            }
        }
        if !changed {
            return closure;
        }
    }
}

fn resolver_diagnostics(
    diagnostics: &BTreeMap<String, Vec<RuntimeModuleDiagnostic>>,
) -> Vec<RepositoryPlanDiagnostic> {
    diagnostics
        .values()
        .flatten()
        .map(|diagnostic| RepositoryPlanDiagnostic {
            code: serde_json::to_value(diagnostic.code)
                .ok()
                .and_then(|value| value.as_str().map(str::to_owned))
                .unwrap_or_else(|| "dependency_error".into()),
            module_id: diagnostic.module_id.clone(),
            dependency_id: diagnostic.dependency_id.clone(),
            required_version: diagnostic.required_version.clone(),
            available_versions: diagnostic.available_versions.clone(),
            related_modules: diagnostic.related_modules.clone(),
        })
        .collect()
}

fn plan_fingerprint(
    generation: u64,
    target_file_name: &str,
    candidates: &[RepositoryCandidate],
    selected: &BTreeMap<String, String>,
) -> String {
    let mut digest = Sha256::new();
    digest.update(generation.to_le_bytes());
    digest.update(target_file_name.as_bytes());
    for candidate in candidates {
        digest.update(candidate.file_name.as_bytes());
        digest.update(candidate.sha256.as_bytes());
    }
    for (id, version) in selected {
        digest.update(id.as_bytes());
        digest.update(version.as_bytes());
    }
    format!("{:x}", digest.finalize())
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

    fn package_for(
        repository: &Path,
        file_name: &str,
        module_id: &str,
        version: &str,
        required: &[(&str, &str)],
        source: &str,
    ) -> PathBuf {
        let path = repository.join(file_name);
        let file = File::create(&path).unwrap();
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        archive.start_file("manifest.json", options).unwrap();
        archive
            .write_all(
                serde_json::json!({
                    "schemaVersion": 2,
                    "id": module_id,
                    "name": { "zh-CN": "问候模块", "en": "Hello Module" },
                    "description": { "zh-CN": "仓库测试模块", "en": "Repository test module" },
                    "version": version,
                    "hostVersion": ">=0.1.0, <0.2.0",
                    "sdkVersion": 2,
                    "entry": "index.js",
                    "dependencies": {
                        "required": required.iter().map(|(id, version)| serde_json::json!({
                            "id": id,
                            "version": version
                        })).collect::<Vec<_>>(),
                        "optional": []
                    },
                    "navigation": [],
                    "settings": []
                })
                .to_string()
                .as_bytes(),
            )
            .unwrap();
        archive.start_file("index.js", options).unwrap();
        archive.write_all(source.as_bytes()).unwrap();
        archive.finish().unwrap();
        path
    }

    fn package(repository: &Path, file_name: &str, version: &str) -> PathBuf {
        package_for(
            repository,
            file_name,
            "hello-module",
            version,
            &[],
            "export async function activate() {}",
        )
    }

    #[test]
    fn plans_transitive_dependencies_in_provider_order_and_keeps_compatible_installed_versions() {
        let temp = tempfile::tempdir().unwrap();
        let repository = temp.path().join("repository");
        fs::create_dir(&repository).unwrap();
        let store = store(temp.path());
        let installed_b = package_for(
            temp.path(),
            "installed-b.mtp",
            "beta-provider",
            "1.0.0",
            &[],
            "export async function activate() {}",
        );
        store.install_with_plan(&installed_b).unwrap();
        package_for(
            &repository,
            "charlie.mtp",
            "charlie-provider",
            "1.0.0",
            &[],
            "export async function activate() {}",
        );
        package_for(
            &repository,
            "beta.mtp",
            "beta-provider",
            "2.0.0",
            &[("charlie-provider", "^1.0.0")],
            "export async function activate() {}",
        );
        package_for(
            &repository,
            "alpha.mtp",
            "alpha-consumer",
            "1.0.0",
            &[("beta-provider", ">=1.0.0, <3.0.0")],
            "export async function activate() {}",
        );

        let plan = preview_repository_install(&store, &repository, "alpha.mtp").unwrap();
        assert!(plan.executable);
        assert_eq!(
            plan.entries
                .iter()
                .map(|entry| entry.module_id.as_str())
                .collect::<Vec<_>>(),
            ["beta-provider", "alpha-consumer"]
        );
        assert_eq!(plan.entries[0].version, "1.0.0");
        assert_eq!(plan.entries[0].action, RepositoryPlanAction::Keep);
    }

    #[test]
    fn plans_required_upgrades_and_rejects_missing_cycles_and_automatic_downgrades() {
        let upgrade_temp = tempfile::tempdir().unwrap();
        let upgrade_repository = upgrade_temp.path().join("repository");
        fs::create_dir(&upgrade_repository).unwrap();
        let upgrade_store = store(upgrade_temp.path());
        let installed = package_for(
            upgrade_temp.path(),
            "installed.mtp",
            "data-provider",
            "1.0.0",
            &[],
            "export async function activate() {}",
        );
        upgrade_store.install_with_plan(&installed).unwrap();
        package_for(
            &upgrade_repository,
            "provider.mtp",
            "data-provider",
            "2.0.0",
            &[],
            "export async function activate() {}",
        );
        package_for(
            &upgrade_repository,
            "consumer.mtp",
            "report-consumer",
            "1.0.0",
            &[("data-provider", "^2.0.0")],
            "export async function activate() {}",
        );
        let upgrade =
            preview_repository_install(&upgrade_store, &upgrade_repository, "consumer.mtp")
                .unwrap();
        assert!(upgrade.executable);
        assert!(
            upgrade
                .entries
                .iter()
                .any(|entry| entry.module_id == "data-provider"
                    && entry.action == RepositoryPlanAction::Upgrade)
        );

        let missing_temp = tempfile::tempdir().unwrap();
        let missing_repository = missing_temp.path().join("repository");
        fs::create_dir(&missing_repository).unwrap();
        package_for(
            &missing_repository,
            "consumer.mtp",
            "report-consumer",
            "1.0.0",
            &[("missing-provider", "^1.0.0")],
            "export async function activate() {}",
        );
        let missing = preview_repository_install(
            &store(missing_temp.path()),
            &missing_repository,
            "consumer.mtp",
        )
        .unwrap();
        assert!(!missing.executable);
        assert!(
            missing
                .diagnostics
                .iter()
                .any(|item| item.code == "missing_dependency" || item.code == "target_unresolved")
        );

        let cycle_temp = tempfile::tempdir().unwrap();
        let cycle_repository = cycle_temp.path().join("repository");
        fs::create_dir(&cycle_repository).unwrap();
        package_for(
            &cycle_repository,
            "alpha.mtp",
            "alpha-module",
            "1.0.0",
            &[("beta-module", "^1.0.0")],
            "export async function activate() {}",
        );
        package_for(
            &cycle_repository,
            "beta.mtp",
            "beta-module",
            "1.0.0",
            &[("alpha-module", "^1.0.0")],
            "export async function activate() {}",
        );
        let cycle =
            preview_repository_install(&store(cycle_temp.path()), &cycle_repository, "alpha.mtp")
                .unwrap();
        assert!(!cycle.executable);
        assert!(
            cycle
                .diagnostics
                .iter()
                .any(|item| item.code == "dependency_cycle" || item.code == "target_unresolved")
        );

        let downgrade_temp = tempfile::tempdir().unwrap();
        let downgrade_repository = downgrade_temp.path().join("repository");
        fs::create_dir(&downgrade_repository).unwrap();
        let downgrade_store = store(downgrade_temp.path());
        let installed = package_for(
            downgrade_temp.path(),
            "installed.mtp",
            "data-provider",
            "2.0.0",
            &[],
            "export async function activate() {}",
        );
        downgrade_store.install_with_plan(&installed).unwrap();
        package_for(
            &downgrade_repository,
            "provider.mtp",
            "data-provider",
            "1.0.0",
            &[],
            "export async function activate() {}",
        );
        package_for(
            &downgrade_repository,
            "consumer.mtp",
            "report-consumer",
            "1.0.0",
            &[("data-provider", "^1.0.0")],
            "export async function activate() {}",
        );
        let downgrade =
            preview_repository_install(&downgrade_store, &downgrade_repository, "consumer.mtp")
                .unwrap();
        assert!(!downgrade.executable);
        assert!(
            downgrade
                .diagnostics
                .iter()
                .any(|item| item.code == "automatic_downgrade")
        );
    }

    #[test]
    fn rejects_different_package_contents_for_the_same_module_version() {
        let temp = tempfile::tempdir().unwrap();
        let repository = temp.path().join("repository");
        fs::create_dir(&repository).unwrap();
        package_for(
            &repository,
            "first.mtp",
            "duplicate-module",
            "1.0.0",
            &[],
            "export const value = 1;",
        );
        package_for(
            &repository,
            "second.mtp",
            "duplicate-module",
            "1.0.0",
            &[],
            "export const value = 2;",
        );
        let plan =
            preview_repository_install(&store(temp.path()), &repository, "first.mtp").unwrap();
        assert!(!plan.executable);
        assert!(
            plan.diagnostics
                .iter()
                .any(|item| item.code == "repository_content_conflict")
        );
    }

    #[test]
    fn binds_plan_ids_to_the_creating_session_and_grant() {
        let temp = tempfile::tempdir().unwrap();
        let repository = temp.path().join("repository");
        fs::create_dir(&repository).unwrap();
        package(&repository, "hello.mtp", "1.0.0");
        let prepared =
            preview_repository_install(&store(temp.path()), &repository, "hello.mtp").unwrap();
        let registry = RepositoryPlanRegistry::default();
        let public = registry
            .insert("session-a", "market-module", "grant-a", prepared.clone())
            .unwrap();
        assert_eq!(
            registry
                .consume("session-b", "market-module", "grant-a", &public.plan_id)
                .unwrap_err(),
            "permission_denied"
        );

        let public = registry
            .insert("session-a", "market-module", "grant-a", prepared)
            .unwrap();
        registry.revoke_session("session-a");
        assert_eq!(
            registry
                .consume("session-a", "market-module", "grant-a", &public.plan_id)
                .unwrap_err(),
            "stale_plan"
        );
    }

    #[test]
    fn rejects_stale_plans_after_package_or_activation_plan_changes() {
        let temp = tempfile::tempdir().unwrap();
        let repository = temp.path().join("repository");
        fs::create_dir(&repository).unwrap();
        package_for(
            &repository,
            "provider.mtp",
            "data-provider",
            "1.0.0",
            &[],
            "export const value = 1;",
        );
        package_for(
            &repository,
            "consumer.mtp",
            "report-consumer",
            "1.0.0",
            &[("data-provider", "^1.0.0")],
            "export async function activate() {}",
        );
        let store = store(temp.path());
        let prepared = preview_repository_install(&store, &repository, "consumer.mtp").unwrap();
        package_for(
            &repository,
            "provider.mtp",
            "data-provider",
            "1.0.0",
            &[],
            "export const value = 2;",
        );
        assert_eq!(
            execute_repository_plan(&store, &repository, &prepared).unwrap_err(),
            "stale_plan"
        );
        assert!(store.snapshot(&[]).unwrap().modules.is_empty());

        package_for(
            &repository,
            "provider.mtp",
            "data-provider",
            "1.0.0",
            &[],
            "export const value = 1;",
        );
        let prepared = preview_repository_install(&store, &repository, "consumer.mtp").unwrap();
        let unrelated = package_for(
            temp.path(),
            "unrelated.mtp",
            "unrelated-module",
            "1.0.0",
            &[],
            "export async function activate() {}",
        );
        store.install_with_plan(&unrelated).unwrap();
        assert_eq!(
            execute_repository_plan(&store, &repository, &prepared).unwrap_err(),
            "stale_plan"
        );
    }

    #[test]
    fn executes_a_transitive_plan_as_one_batch() {
        let temp = tempfile::tempdir().unwrap();
        let repository = temp.path().join("repository");
        fs::create_dir(&repository).unwrap();
        package_for(
            &repository,
            "charlie.mtp",
            "charlie-provider",
            "1.0.0",
            &[],
            "export async function activate() {}",
        );
        package_for(
            &repository,
            "beta.mtp",
            "beta-provider",
            "1.0.0",
            &[("charlie-provider", "^1.0.0")],
            "export async function activate() {}",
        );
        package_for(
            &repository,
            "alpha.mtp",
            "alpha-consumer",
            "1.0.0",
            &[("beta-provider", "^1.0.0")],
            "export async function activate() {}",
        );
        let store = store(temp.path());
        let prepared = preview_repository_install(&store, &repository, "alpha.mtp").unwrap();
        let result = execute_repository_plan(&store, &repository, &prepared).unwrap();
        assert_eq!(result.target_module_id, "alpha-consumer");
        assert_eq!(
            result
                .modules
                .iter()
                .map(|module| module.module_id.as_str())
                .collect::<Vec<_>>(),
            ["charlie-provider", "beta-provider", "alpha-consumer"]
        );
        assert!(
            result
                .modules
                .iter()
                .all(|module| module.status == RuntimeModuleStatus::Active)
        );
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
