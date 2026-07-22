use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
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

use super::manifest::{RuntimeModuleDependency, RuntimeModuleManifest, is_module_id};
use super::plan::ActivationPlanStore;
use super::resolver::{ResolveRequest, resolve};
use super::types::{RuntimeModuleActivationPlan, RuntimeModuleDiagnostic, RuntimeModuleStatus};
use super::types::{RuntimeModuleCommandError, RuntimeModuleImpact, RuntimeModuleImpactCode};

const MAX_PACKAGE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 10 * 1024 * 1024;
const MAX_FILES: usize = 256;
const MAX_RESOLUTION_NODES: usize = 50_000;

type ModuleCatalog = BTreeMap<String, Vec<RuntimeModuleManifest>>;
type ModuleStates = BTreeMap<String, RuntimeModuleState>;

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
    #[serde(default)]
    pub blocked_versions: BTreeSet<String>,
    pub last_error: Option<RuntimeModuleError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRuntimeModule {
    pub manifest: RuntimeModuleManifest,
    pub desired_enabled: bool,
    pub selected_version: Option<String>,
    pub previous_selected_version: Option<String>,
    pub selected_sha256: Option<String>,
    pub status: RuntimeModuleStatus,
    pub diagnostics: Vec<RuntimeModuleDiagnostic>,
    pub required_dependencies: Vec<RuntimeModuleDependency>,
    pub optional_dependencies: Vec<RuntimeModuleDependency>,
    pub dependents: Vec<String>,
    pub active_version: String,
    pub previous_version: Option<String>,
    pub available_versions: Vec<String>,
    pub active_sha256: String,
    pub blocked_version: Option<String>,
    pub last_error: Option<RuntimeModuleError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModulePlanSnapshot {
    pub plan: RuntimeModuleActivationPlan,
    pub modules: Vec<InstalledRuntimeModule>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModuleOperationResult {
    pub module_id: String,
    pub package_installed: bool,
    pub plan_changed: bool,
    pub plan: RuntimeModuleActivationPlan,
    pub modules: Vec<InstalledRuntimeModule>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModuleEntry {
    pub manifest: RuntimeModuleManifest,
    pub source: String,
}

#[cfg(test)]
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

    #[cfg(test)]
    pub fn list(&self) -> Result<Vec<InstalledRuntimeModule>, String> {
        Ok(self.snapshot(&[])?.modules)
    }

    pub fn snapshot(
        &self,
        legacy_disabled_module_ids: &[String],
    ) -> Result<RuntimeModulePlanSnapshot, String> {
        self.cleanup_staging()?;
        let (catalog, states) = self.catalog_and_states()?;
        let plan = self.load_or_migrate_plan(&catalog, &states, legacy_disabled_module_ids)?;
        let mut chosen_manifests = BTreeMap::new();
        for (id, state) in &states {
            let version = plan
                .selected_versions
                .get(id)
                .cloned()
                .or_else(|| highest_version(state.versions.keys().cloned()))
                .unwrap_or_else(|| state.active_version.clone());
            if let Ok(manifest) = self.read_manifest(id, &version) {
                chosen_manifests.insert(id.clone(), manifest);
            }
        }

        let mut dependents = BTreeMap::<String, Vec<String>>::new();
        for (consumer_id, manifest) in &chosen_manifests {
            for dependency in &manifest.dependencies.required {
                dependents
                    .entry(dependency.id.clone())
                    .or_default()
                    .push(consumer_id.clone());
            }
        }
        for values in dependents.values_mut() {
            values.sort();
            values.dedup();
        }

        let mut modules = Vec::new();
        for (id, state) in &states {
            let Some(manifest) = chosen_manifests.get(id).cloned() else {
                continue;
            };
            let selected_version = plan.selected_versions.get(id).cloned();
            let selected_sha256 = selected_version
                .as_ref()
                .and_then(|version| state.versions.get(version))
                .map(|record| record.sha256.clone());
            let desired_enabled = plan.desired_enabled.get(id).copied().unwrap_or(false);
            let diagnostics = plan.diagnostics.get(id).cloned().unwrap_or_default();
            let status = if !desired_enabled {
                RuntimeModuleStatus::Disabled
            } else if selected_version.is_some() {
                RuntimeModuleStatus::Active
            } else if state.last_error.is_some() {
                RuntimeModuleStatus::Blocked
            } else {
                RuntimeModuleStatus::Waiting
            };
            let mut available_versions = state.versions.keys().cloned().collect::<Vec<_>>();
            sort_versions_desc(&mut available_versions);
            let display_version = selected_version
                .clone()
                .unwrap_or_else(|| manifest.version.clone());
            let display_sha256 = selected_sha256.clone().unwrap_or_default();
            modules.push(InstalledRuntimeModule {
                required_dependencies: manifest.dependencies.required.clone(),
                optional_dependencies: manifest.dependencies.optional.clone(),
                dependents: dependents.remove(id).unwrap_or_default(),
                manifest,
                desired_enabled,
                selected_version: selected_version.clone(),
                previous_selected_version: plan.previous_selected_versions.get(id).cloned(),
                selected_sha256,
                status,
                diagnostics,
                active_version: display_version,
                previous_version: plan.previous_selected_versions.get(id).cloned(),
                available_versions,
                active_sha256: display_sha256,
                blocked_version: state.blocked_version.clone(),
                last_error: state.last_error.clone(),
            });
        }
        modules.sort_by(|left, right| left.manifest.name.cmp(&right.manifest.name));
        Ok(RuntimeModulePlanSnapshot { plan, modules })
    }

    fn catalog_and_states(&self) -> Result<(ModuleCatalog, ModuleStates), String> {
        let mut catalog = BTreeMap::<String, Vec<RuntimeModuleManifest>>::new();
        let mut states = BTreeMap::<String, RuntimeModuleState>::new();
        if !self.root.exists() {
            return Ok((catalog, states));
        }
        for entry in fs::read_dir(&self.root).map_err(io_error("read module directory"))? {
            let entry = entry.map_err(io_error("read module directory entry"))?;
            if !entry
                .file_type()
                .map_err(io_error("inspect module directory entry"))?
                .is_dir()
            {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            if id.starts_with('.') || !is_module_id(&id) {
                continue;
            }
            let Ok(state) = read_state(&entry.path().join("state.json")) else {
                continue;
            };
            let mut manifests = state
                .versions
                .keys()
                .filter(|version| !state.blocked_versions.contains(*version))
                .filter_map(|version| self.read_manifest(&id, version).ok())
                .collect::<Vec<_>>();
            manifests.sort_by(|left, right| {
                Version::parse(&right.version)
                    .ok()
                    .cmp(&Version::parse(&left.version).ok())
            });
            if !state.versions.is_empty() {
                if !manifests.is_empty() {
                    catalog.insert(id.clone(), manifests);
                }
                states.insert(id, state);
            }
        }
        Ok((catalog, states))
    }

    fn load_or_migrate_plan(
        &self,
        catalog: &BTreeMap<String, Vec<RuntimeModuleManifest>>,
        states: &BTreeMap<String, RuntimeModuleState>,
        legacy_disabled_module_ids: &[String],
    ) -> Result<RuntimeModuleActivationPlan, String> {
        let plan_store = ActivationPlanStore::new(self.root.clone());
        if let Some(plan) = plan_store.load()? {
            return Ok(plan);
        }
        let disabled = legacy_disabled_module_ids.iter().collect::<HashSet<_>>();
        let desired_enabled = states
            .keys()
            .map(|id| (id.clone(), !disabled.contains(id)))
            .collect::<BTreeMap<_, _>>();
        let desired_set = desired_enabled
            .iter()
            .filter(|(_, enabled)| **enabled)
            .map(|(id, _)| id.clone())
            .collect();
        let current_selected = states
            .iter()
            .filter(|(id, _)| desired_enabled.get(*id).copied().unwrap_or(false))
            .map(|(id, state)| (id.clone(), state.active_version.clone()))
            .collect();
        let resolved = resolve(&ResolveRequest {
            catalog: catalog.clone(),
            desired_enabled: desired_set,
            current_selected,
            preferred: None,
            max_search_nodes: MAX_RESOLUTION_NODES,
        });
        plan_store.commit(desired_enabled, resolved)
    }

    fn resolve_and_commit(
        &self,
        desired_enabled: BTreeMap<String, bool>,
        preferred: Option<(String, String)>,
        current: &RuntimeModuleActivationPlan,
    ) -> Result<(RuntimeModuleActivationPlan, bool), String> {
        let (catalog, _) = self.catalog_and_states()?;
        let desired_set = desired_enabled
            .iter()
            .filter(|(_, enabled)| **enabled)
            .map(|(id, _)| id.clone())
            .collect();
        let resolved = resolve(&ResolveRequest {
            catalog,
            desired_enabled: desired_set,
            current_selected: current.selected_versions.clone(),
            preferred,
            max_search_nodes: MAX_RESOLUTION_NODES,
        });
        let changed = current.desired_enabled != desired_enabled
            || current.selected_versions != resolved.selected_versions
            || current.activation_order != resolved.activation_order
            || current.diagnostics != resolved.diagnostics;
        if !changed {
            return Ok((current.clone(), false));
        }
        let plan = ActivationPlanStore::new(self.root.clone()).commit(desired_enabled, resolved)?;
        self.sync_legacy_states(&plan)?;
        Ok((plan, true))
    }

    fn operation_from_resolution(
        &self,
        module_id: &str,
        desired_enabled: BTreeMap<String, bool>,
        preferred: Option<(String, String)>,
        current: &RuntimeModuleActivationPlan,
    ) -> Result<RuntimeModuleOperationResult, String> {
        let (plan, plan_changed) = self.resolve_and_commit(desired_enabled, preferred, current)?;
        let modules = self.snapshot(&[])?.modules;
        Ok(RuntimeModuleOperationResult {
            module_id: module_id.into(),
            package_installed: false,
            plan_changed,
            plan,
            modules,
        })
    }

    fn operation_from_resolved(
        &self,
        module_id: &str,
        desired_enabled: BTreeMap<String, bool>,
        resolved: super::resolver::ResolveResult,
        current: &RuntimeModuleActivationPlan,
    ) -> Result<RuntimeModuleOperationResult, String> {
        let changed = current.desired_enabled != desired_enabled
            || current.selected_versions != resolved.selected_versions
            || current.activation_order != resolved.activation_order
            || current.diagnostics != resolved.diagnostics;
        let plan = if changed {
            let plan =
                ActivationPlanStore::new(self.root.clone()).commit(desired_enabled, resolved)?;
            self.sync_legacy_states(&plan)?;
            plan
        } else {
            current.clone()
        };
        let modules = self.snapshot(&[])?.modules;
        Ok(RuntimeModuleOperationResult {
            module_id: module_id.into(),
            package_installed: false,
            plan_changed: changed,
            plan,
            modules,
        })
    }

    fn sync_legacy_states(&self, plan: &RuntimeModuleActivationPlan) -> Result<(), String> {
        for (id, selected_version) in &plan.selected_versions {
            let module_dir = self.module_dir(id);
            let mut state = read_state(&module_dir.join("state.json"))?;
            if state.active_version != *selected_version {
                let old_active =
                    std::mem::replace(&mut state.active_version, selected_version.clone());
                state.previous_version = Some(old_active);
                write_state(&module_dir, &state)?;
            }
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn install(&self, package_path: &Path) -> Result<InstalledRuntimeModule, String> {
        let result = self.install_with_plan(package_path)?;
        result
            .modules
            .into_iter()
            .find(|module| module.manifest.id == result.module_id)
            .ok_or_else(|| "installed module is missing from plan snapshot".into())
    }

    pub fn install_with_plan(
        &self,
        package_path: &Path,
    ) -> Result<RuntimeModuleOperationResult, String> {
        let plan_existed = ActivationPlanStore::new(self.root.clone())
            .load()?
            .is_some();
        let (module_id, version) = self.save_package(package_path)?;
        let snapshot = self.snapshot(&[])?;
        let mut desired_enabled = snapshot.plan.desired_enabled.clone();
        desired_enabled.insert(module_id.clone(), true);
        let prefer_incoming = snapshot
            .plan
            .selected_versions
            .get(&module_id)
            .and_then(|selected| Version::parse(selected).ok())
            .is_none_or(|selected| {
                Version::parse(&version).is_ok_and(|incoming| incoming > selected)
            });
        let (plan, plan_changed) = self.resolve_and_commit(
            desired_enabled,
            prefer_incoming.then(|| (module_id.clone(), version)),
            &snapshot.plan,
        )?;
        let modules = self.snapshot(&[])?.modules;
        Ok(RuntimeModuleOperationResult {
            module_id,
            package_installed: true,
            plan_changed: plan_changed || !plan_existed,
            plan,
            modules,
        })
    }

    pub fn set_enabled(
        &self,
        module_id: &str,
        enabled: bool,
    ) -> Result<RuntimeModuleOperationResult, RuntimeModuleCommandError> {
        validate_module_id(module_id).map_err(RuntimeModuleCommandError::from)?;
        let snapshot = self
            .snapshot(&[])
            .map_err(RuntimeModuleCommandError::from)?;
        if !snapshot
            .modules
            .iter()
            .any(|module| module.manifest.id == module_id)
        {
            return Err(format!("module is not installed: {module_id}").into());
        }
        if !enabled {
            let related_modules = snapshot
                .modules
                .iter()
                .filter(|module| {
                    module.desired_enabled
                        && module
                            .required_dependencies
                            .iter()
                            .any(|dependency| dependency.id == module_id)
                })
                .map(|module| module.manifest.id.clone())
                .collect::<Vec<_>>();
            if !related_modules.is_empty() {
                return Err(RuntimeModuleCommandError::DependencyImpact {
                    impact: RuntimeModuleImpact {
                        code: RuntimeModuleImpactCode::RequiredByEnabledModules,
                        module_id: module_id.into(),
                        related_modules,
                        selected_version: snapshot.plan.selected_versions.get(module_id).cloned(),
                        requested_version: None,
                    },
                });
            }
        }
        let mut desired_enabled = snapshot.plan.desired_enabled.clone();
        desired_enabled.insert(module_id.into(), enabled);
        self.operation_from_resolution(module_id, desired_enabled, None, &snapshot.plan)
            .map_err(RuntimeModuleCommandError::from)
    }

    pub fn rollback_with_plan(
        &self,
        module_id: &str,
    ) -> Result<RuntimeModuleOperationResult, RuntimeModuleCommandError> {
        validate_module_id(module_id).map_err(RuntimeModuleCommandError::from)?;
        let snapshot = self
            .snapshot(&[])
            .map_err(RuntimeModuleCommandError::from)?;
        let requested_version = snapshot
            .plan
            .previous_selected_versions
            .get(module_id)
            .cloned()
            .ok_or_else(|| RuntimeModuleCommandError::Message {
                message: format!("module {module_id} has no previous selected version"),
            })?;
        let (catalog, _) = self
            .catalog_and_states()
            .map_err(RuntimeModuleCommandError::from)?;
        if !catalog.get(module_id).is_some_and(|versions| {
            versions
                .iter()
                .any(|manifest| manifest.version == requested_version)
        }) {
            return Err(format!("previous module version is missing: {requested_version}").into());
        }
        let desired_enabled = snapshot.plan.desired_enabled.clone();
        let desired_set = desired_enabled
            .iter()
            .filter(|(_, enabled)| **enabled)
            .map(|(id, _)| id.clone())
            .collect();
        let resolved = resolve(&ResolveRequest {
            catalog,
            desired_enabled: desired_set,
            current_selected: snapshot.plan.selected_versions.clone(),
            preferred: Some((module_id.into(), requested_version.clone())),
            max_search_nodes: MAX_RESOLUTION_NODES,
        });
        if resolved.selected_versions.get(module_id) != Some(&requested_version) {
            return Err(format!(
                "module {module_id} cannot safely roll back to {requested_version}"
            )
            .into());
        }
        let related_modules = resolved
            .selected_versions
            .iter()
            .filter(|(id, version)| {
                id.as_str() != module_id
                    && snapshot.plan.selected_versions.get(*id) != Some(*version)
            })
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        if !related_modules.is_empty() {
            return Err(RuntimeModuleCommandError::DependencyImpact {
                impact: RuntimeModuleImpact {
                    code: RuntimeModuleImpactCode::RollbackRequiresCoordinatedChange,
                    module_id: module_id.into(),
                    related_modules,
                    selected_version: snapshot.plan.selected_versions.get(module_id).cloned(),
                    requested_version: Some(requested_version),
                },
            });
        }
        self.operation_from_resolved(module_id, desired_enabled, resolved, &snapshot.plan)
            .map_err(RuntimeModuleCommandError::from)
    }

    pub fn uninstall_with_plan(
        &self,
        module_id: &str,
    ) -> Result<RuntimeModuleOperationResult, RuntimeModuleCommandError> {
        validate_module_id(module_id).map_err(RuntimeModuleCommandError::from)?;
        let snapshot = self
            .snapshot(&[])
            .map_err(RuntimeModuleCommandError::from)?;
        let related_modules = self
            .installed_required_dependents(module_id)
            .map_err(RuntimeModuleCommandError::from)?;
        if !related_modules.is_empty() {
            return Err(RuntimeModuleCommandError::DependencyImpact {
                impact: RuntimeModuleImpact {
                    code: RuntimeModuleImpactCode::RequiredByInstalledModules,
                    module_id: module_id.into(),
                    related_modules,
                    selected_version: snapshot.plan.selected_versions.get(module_id).cloned(),
                    requested_version: None,
                },
            });
        }
        let module_dir = self.module_dir(module_id);
        if !module_dir.exists() {
            return Err(format!("module is not installed: {module_id}").into());
        }
        let removal_dir = self
            .root
            .join(".removing")
            .join(format!("{module_id}-{}", unique_suffix()));
        fs::create_dir_all(removal_dir.parent().expect("removal directory has parent"))
            .map_err(io_error("create module removal directory"))
            .map_err(RuntimeModuleCommandError::from)?;
        fs::rename(&module_dir, &removal_dir)
            .map_err(io_error("stage installed module removal"))
            .map_err(RuntimeModuleCommandError::from)?;
        let mut desired_enabled = snapshot.plan.desired_enabled.clone();
        desired_enabled.remove(module_id);
        let operation =
            self.operation_from_resolution(module_id, desired_enabled, None, &snapshot.plan);
        if let Err(error) = &operation {
            let _ = fs::rename(&removal_dir, &module_dir);
            return Err(error.clone().into());
        }
        fs::remove_dir_all(&removal_dir)
            .map_err(io_error("remove installed module"))
            .map_err(RuntimeModuleCommandError::from)?;
        operation.map_err(RuntimeModuleCommandError::from)
    }

    fn installed_required_dependents(&self, module_id: &str) -> Result<Vec<String>, String> {
        let (_, states) = self.catalog_and_states()?;
        let mut dependents = Vec::new();
        for (candidate_id, state) in states {
            if candidate_id == module_id {
                continue;
            }
            let depends_on_target = state.versions.keys().try_fold(false, |found, version| {
                if found {
                    return Ok(true);
                }
                let manifest = self.read_manifest(&candidate_id, version)?;
                Ok::<_, String>(
                    manifest
                        .dependencies
                        .required
                        .iter()
                        .any(|dependency| dependency.id == module_id),
                )
            })?;
            if depends_on_target {
                dependents.push(candidate_id);
            }
        }
        dependents.sort();
        Ok(dependents)
    }

    fn save_package(&self, package_path: &Path) -> Result<(String, String), String> {
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
            blocked_versions: BTreeSet::new(),
            last_error: None,
        });
        state
            .versions
            .insert(manifest.version.clone(), ModuleVersionRecord { sha256 });

        if let Err(error) = write_state(&module_dir, &state) {
            let _ = fs::remove_dir_all(&final_version_dir);
            return Err(error);
        }
        Ok((manifest.id, manifest.version))
    }

    pub fn read_entry(&self, module_id: &str) -> Result<RuntimeModuleEntry, String> {
        validate_module_id(module_id)?;
        let snapshot = self.snapshot(&[])?;
        if snapshot
            .modules
            .iter()
            .find(|module| module.manifest.id == module_id)
            .is_some_and(|module| module.status == RuntimeModuleStatus::Blocked)
        {
            return Err(format!(
                "module {module_id} is blocked after activation failure"
            ));
        }
        let selected_version = snapshot
            .plan
            .selected_versions
            .get(module_id)
            .ok_or_else(|| format!("module {module_id} is not selected for activation"))?;
        let manifest = self.read_manifest(module_id, selected_version)?;
        let entry_path = self
            .version_dir(module_id, selected_version)
            .join(&manifest.entry);
        let metadata = fs::metadata(&entry_path).map_err(io_error("read module entry metadata"))?;
        if metadata.len() > MAX_ENTRY_BYTES {
            return Err(format!("module entry exceeds {MAX_ENTRY_BYTES} bytes"));
        }
        let source = fs::read_to_string(&entry_path).map_err(io_error("read module entry"))?;
        Ok(RuntimeModuleEntry { manifest, source })
    }

    #[cfg(test)]
    pub fn rollback(&self, module_id: &str) -> Result<InstalledRuntimeModule, String> {
        let result = self
            .rollback_with_plan(module_id)
            .map_err(command_error_text)?;
        result
            .modules
            .into_iter()
            .find(|module| module.manifest.id == module_id)
            .ok_or_else(|| format!("module is missing after rollback: {module_id}"))
    }

    #[cfg(test)]
    pub fn report_activation_failure(
        &self,
        module_id: &str,
        failed_version: &str,
        message: &str,
    ) -> Result<ActivationFailureResult, String> {
        let result =
            self.report_activation_failure_with_plan(module_id, failed_version, message)?;
        let module = result
            .modules
            .into_iter()
            .find(|module| module.manifest.id == module_id)
            .ok_or_else(|| format!("module is missing after activation failure: {module_id}"))?;
        Ok(ActivationFailureResult {
            rolled_back: module.selected_version.as_deref() != Some(failed_version)
                && module.selected_version.is_some(),
            module,
        })
    }

    pub fn report_activation_failure_with_plan(
        &self,
        module_id: &str,
        failed_version: &str,
        message: &str,
    ) -> Result<RuntimeModuleOperationResult, String> {
        validate_module_id(module_id)?;
        if message.trim().is_empty() {
            return Err("activation failure message cannot be empty".into());
        }
        let snapshot = self.snapshot(&[])?;
        if snapshot
            .plan
            .selected_versions
            .get(module_id)
            .map(String::as_str)
            != Some(failed_version)
        {
            return Err(format!(
                "cannot report failure for inactive version {failed_version}"
            ));
        }
        let module_dir = self.module_dir(module_id);
        let mut state = read_state(&module_dir.join("state.json"))?;
        state.blocked_version = Some(failed_version.into());
        state.blocked_versions.insert(failed_version.into());
        state.last_error = Some(RuntimeModuleError {
            version: failed_version.into(),
            message: message.trim().chars().take(1_000).collect(),
            occurred_at: unique_suffix(),
        });
        write_state(&module_dir, &state)?;
        self.operation_from_resolution(
            module_id,
            snapshot.plan.desired_enabled.clone(),
            None,
            &snapshot.plan,
        )
    }

    #[cfg(test)]
    pub fn uninstall(&self, module_id: &str) -> Result<(), String> {
        self.uninstall_with_plan(module_id)
            .map(|_| ())
            .map_err(command_error_text)
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
    let mut state: RuntimeModuleState =
        serde_json::from_slice(&bytes).map_err(|error| format!("invalid module state: {error}"))?;
    if let Some(version) = &state.blocked_version {
        state.blocked_versions.insert(version.clone());
    }
    Ok(state)
}

fn highest_version(versions: impl Iterator<Item = String>) -> Option<String> {
    let mut versions = versions.collect::<Vec<_>>();
    sort_versions_desc(&mut versions);
    versions.into_iter().next()
}

fn sort_versions_desc(versions: &mut [String]) {
    versions.sort_by(|left, right| {
        Version::parse(right)
            .ok()
            .cmp(&Version::parse(left).ok())
            .then_with(|| right.cmp(left))
    });
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

#[cfg(test)]
fn command_error_text(error: RuntimeModuleCommandError) -> String {
    match error {
        RuntimeModuleCommandError::Message { message } => message,
        RuntimeModuleCommandError::DependencyImpact { impact } => format!(
            "dependency impact {:?} for {}: {}",
            impact.code,
            impact.module_id,
            impact.related_modules.join(", ")
        ),
    }
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

    fn package_for(
        directory: &Path,
        name: &str,
        id: &str,
        version: &str,
        required: &[(&str, &str)],
    ) -> PathBuf {
        let path = directory.join(format!("{name}.mtp"));
        let file = File::create(&path).unwrap();
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        archive.start_file("manifest.json", options).unwrap();
        let dependencies = required
            .iter()
            .map(|(dependency_id, requirement)| {
                serde_json::json!({ "id": dependency_id, "version": requirement })
            })
            .collect::<Vec<_>>();
        let manifest = serde_json::json!({
            "schemaVersion": 1,
            "id": id,
            "name": id,
            "description": format!("{id} test module"),
            "version": version,
            "hostVersion": ">=0.1.0, <0.2.0",
            "sdkVersion": 1,
            "entry": "index.js",
            "dependencies": { "required": dependencies, "optional": [] },
            "navigation": [],
            "settings": []
        });
        archive.write_all(manifest.to_string().as_bytes()).unwrap();
        archive.start_file("index.js", options).unwrap();
        archive
            .write_all(b"export async function activate() {}")
            .unwrap();
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
            .save_package(&package(temp.path(), "v1", "1.0.0", true, &[]))
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
    fn migrates_v1_state_once_and_absorbs_legacy_disabled_modules() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .save_package(&package(temp.path(), "v1", "1.0.0", true, &[]))
            .unwrap();

        let first = store.snapshot(&["hello-module".into()]).unwrap();
        assert_eq!(first.plan.generation, 1);
        assert!(!first.plan.desired_enabled["hello-module"]);
        assert!(first.plan.selected_versions.is_empty());
        assert_eq!(first.modules[0].status, RuntimeModuleStatus::Disabled);

        let repeated = store.snapshot(&[]).unwrap();
        assert_eq!(repeated.plan, first.plan);
        assert_eq!(repeated.modules[0].status, RuntimeModuleStatus::Disabled);
    }

    #[test]
    fn migrates_the_v1_active_version_and_isolates_a_corrupt_module_state() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .save_package(&package(temp.path(), "v1", "1.0.0", true, &[]))
            .unwrap();
        store
            .save_package(&package(temp.path(), "v2", "1.1.0", true, &[]))
            .unwrap();
        let module_dir = temp.path().join("modules/hello-module");
        let mut legacy = read_state(&module_dir.join("state.json")).unwrap();
        legacy.previous_version = Some("1.0.0".into());
        legacy.active_version = "1.1.0".into();
        write_state(&module_dir, &legacy).unwrap();
        let corrupt = temp.path().join("modules/corrupt-module");
        fs::create_dir_all(&corrupt).unwrap();
        fs::write(corrupt.join("state.json"), b"{bad-json").unwrap();

        let snapshot = store.snapshot(&[]).unwrap();
        assert_eq!(snapshot.plan.selected_versions["hello-module"], "1.1.0");
        assert_eq!(snapshot.modules.len(), 1);
        assert_eq!(
            snapshot.modules[0].selected_version.as_deref(),
            Some("1.1.0")
        );
    }

    #[test]
    fn installs_a_waiting_module_then_activates_it_when_its_dependency_arrives() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        let waiting = store
            .install_with_plan(&package_for(
                temp.path(),
                "consumer",
                "report-consumer",
                "1.0.0",
                &[("data-provider", "^1.0.0")],
            ))
            .unwrap();
        let consumer = waiting
            .modules
            .iter()
            .find(|module| module.manifest.id == "report-consumer")
            .unwrap();
        assert!(waiting.package_installed);
        assert_eq!(consumer.status, RuntimeModuleStatus::Waiting);
        assert_eq!(consumer.selected_version, None);

        let activated = store
            .install_with_plan(&package_for(
                temp.path(),
                "provider",
                "data-provider",
                "1.0.0",
                &[],
            ))
            .unwrap();
        assert_eq!(
            activated.plan.activation_order,
            vec!["data-provider", "report-consumer"]
        );
        assert!(
            activated
                .modules
                .iter()
                .all(|module| module.status == RuntimeModuleStatus::Active)
        );
    }

    #[test]
    fn coordinates_installed_provider_and_consumer_upgrades_atomically() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package_for(
                temp.path(),
                "a1",
                "data-provider",
                "1.0.0",
                &[],
            ))
            .unwrap();
        store
            .install(&package_for(
                temp.path(),
                "b1",
                "report-consumer",
                "1.0.0",
                &[("data-provider", "^1.0.0")],
            ))
            .unwrap();

        let waiting = store
            .install_with_plan(&package_for(
                temp.path(),
                "b2",
                "report-consumer",
                "2.0.0",
                &[("data-provider", "^2.0.0")],
            ))
            .unwrap();
        assert!(!waiting.plan_changed);
        assert_eq!(waiting.plan.selected_versions["report-consumer"], "1.0.0");

        let coordinated = store
            .install_with_plan(&package_for(
                temp.path(),
                "a2",
                "data-provider",
                "2.0.0",
                &[],
            ))
            .unwrap();
        assert!(coordinated.plan_changed);
        assert_eq!(coordinated.plan.selected_versions["data-provider"], "2.0.0");
        assert_eq!(
            coordinated.plan.selected_versions["report-consumer"],
            "2.0.0"
        );
    }

    #[test]
    fn blocks_provider_disable_and_uninstall_while_a_dependent_is_installed() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package_for(
                temp.path(),
                "provider",
                "data-provider",
                "1.0.0",
                &[],
            ))
            .unwrap();
        store
            .install(&package_for(
                temp.path(),
                "consumer",
                "report-consumer",
                "1.0.0",
                &[("data-provider", "^1.0.0")],
            ))
            .unwrap();

        let disable = store.set_enabled("data-provider", false).unwrap_err();
        assert!(
            matches!(disable, RuntimeModuleCommandError::DependencyImpact { impact } if impact.code == RuntimeModuleImpactCode::RequiredByEnabledModules && impact.related_modules == ["report-consumer"])
        );

        store.set_enabled("report-consumer", false).unwrap();
        store.set_enabled("data-provider", false).unwrap();
        let uninstall = store.uninstall_with_plan("data-provider").unwrap_err();
        assert!(
            matches!(uninstall, RuntimeModuleCommandError::DependencyImpact { impact } if impact.code == RuntimeModuleImpactCode::RequiredByInstalledModules && impact.related_modules == ["report-consumer"])
        );
    }

    #[test]
    fn rejects_a_rollback_that_requires_an_implicit_dependent_downgrade() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package_for(
                temp.path(),
                "a1",
                "data-provider",
                "1.0.0",
                &[],
            ))
            .unwrap();
        store
            .install(&package_for(
                temp.path(),
                "b1",
                "report-consumer",
                "1.0.0",
                &[("data-provider", "^1.0.0")],
            ))
            .unwrap();
        store
            .install(&package_for(
                temp.path(),
                "b2",
                "report-consumer",
                "2.0.0",
                &[("data-provider", "^2.0.0")],
            ))
            .unwrap();
        store
            .install(&package_for(
                temp.path(),
                "a2",
                "data-provider",
                "2.0.0",
                &[],
            ))
            .unwrap();

        let error = store.rollback_with_plan("data-provider").unwrap_err();
        assert!(
            matches!(error, RuntimeModuleCommandError::DependencyImpact { impact } if impact.code == RuntimeModuleImpactCode::RollbackRequiresCoordinatedChange && impact.related_modules == ["report-consumer"])
        );
        assert_eq!(
            store.snapshot(&[]).unwrap().plan.selected_versions["data-provider"],
            "2.0.0"
        );
    }

    #[test]
    fn blocks_uninstall_for_a_dependency_used_only_by_an_unselected_installed_version() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package_for(
                temp.path(),
                "a1",
                "data-provider",
                "1.0.0",
                &[],
            ))
            .unwrap();
        store
            .install(&package_for(
                temp.path(),
                "b1",
                "report-consumer",
                "1.0.0",
                &[],
            ))
            .unwrap();
        let waiting = store
            .install_with_plan(&package_for(
                temp.path(),
                "b2",
                "report-consumer",
                "2.0.0",
                &[("data-provider", "^2.0.0")],
            ))
            .unwrap();
        assert_eq!(waiting.plan.selected_versions["report-consumer"], "1.0.0");

        let error = store.uninstall_with_plan("data-provider").unwrap_err();
        assert!(
            matches!(error, RuntimeModuleCommandError::DependencyImpact { impact } if impact.related_modules == ["report-consumer"])
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
    fn rejects_duplicate_versions_but_keeps_a_newly_installed_lower_version_unselected() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(temp.path());
        store
            .install(&package(temp.path(), "v2", "2.0.0", true, &[]))
            .unwrap();

        assert!(
            store
                .install(&package(temp.path(), "same", "2.0.0", true, &[]))
                .unwrap_err()
                .contains("already installed")
        );
        let lower = store
            .install_with_plan(&package(temp.path(), "lower", "1.9.0", true, &[]))
            .unwrap();
        assert!(!lower.plan_changed);
        assert_eq!(lower.plan.selected_versions["hello-module"], "2.0.0");
        assert_eq!(lower.modules[0].available_versions, ["2.0.0", "1.9.0"]);
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
        assert_eq!(second_failure.module.selected_version, None);
        assert_eq!(second_failure.module.status, RuntimeModuleStatus::Blocked);
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
