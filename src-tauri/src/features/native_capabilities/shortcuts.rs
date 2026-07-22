use std::{collections::BTreeMap, fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

use super::permissions::{NativeCapabilities, ShortcutDeclaration};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ShortcutState {
    Registered,
    Conflict,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    pub shortcut_id: String,
    pub accelerator: Option<String>,
    pub state: ShortcutState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutEvent {
    pub module_id: String,
    pub shortcut_id: String,
    pub session_token: String,
}

#[derive(Debug, Clone)]
struct ShortcutOwner {
    module_id: String,
    shortcut_id: String,
}

#[derive(Debug, Clone)]
struct ActiveModule {
    session_token: String,
    statuses: BTreeMap<String, ShortcutStatus>,
}

#[derive(Debug, Default)]
struct RuntimeState {
    modules: BTreeMap<String, ActiveModule>,
    owners: BTreeMap<String, ShortcutOwner>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutPreference {
    accelerator: Option<String>,
    disabled: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PreferenceFile {
    modules: BTreeMap<String, BTreeMap<String, ShortcutPreference>>,
}

#[derive(Debug)]
pub struct ShortcutRegistry {
    path: PathBuf,
    runtime: Mutex<RuntimeState>,
}

impl ShortcutRegistry {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            runtime: Mutex::new(RuntimeState::default()),
        }
    }

    pub fn activate_module(
        &self,
        module_id: &str,
        session_token: &str,
        shortcuts: Vec<ShortcutDeclaration>,
    ) -> Result<Vec<ShortcutStatus>, String> {
        let normalized = normalize_shortcuts(shortcuts)?;
        if session_token.is_empty() {
            return Err("shortcut session token must not be empty".into());
        }
        let preferences = self.load_preferences()?;
        let module_preferences = preferences.modules.get(module_id);
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "shortcut registry lock poisoned")?;
        if runtime.modules.contains_key(module_id) {
            return Err(format!("shortcut module is already active: {module_id}"));
        }

        let mut statuses = BTreeMap::new();
        for declaration in normalized {
            let preference = module_preferences.and_then(|items| items.get(&declaration.id));
            let disabled = preference.is_some_and(|item| item.disabled);
            let accelerator = preference
                .and_then(|item| item.accelerator.clone())
                .unwrap_or(declaration.accelerator);
            if disabled {
                statuses.insert(
                    declaration.id.clone(),
                    ShortcutStatus {
                        shortcut_id: declaration.id,
                        accelerator: None,
                        state: ShortcutState::Disabled,
                    },
                );
                continue;
            }

            validate_runtime_accelerator(&accelerator)?;
            let key = accelerator_key(&accelerator);
            let state = if runtime.owners.contains_key(&key) {
                ShortcutState::Conflict
            } else {
                runtime.owners.insert(
                    key,
                    ShortcutOwner {
                        module_id: module_id.to_owned(),
                        shortcut_id: declaration.id.clone(),
                    },
                );
                ShortcutState::Registered
            };
            statuses.insert(
                declaration.id.clone(),
                ShortcutStatus {
                    shortcut_id: declaration.id,
                    accelerator: Some(accelerator),
                    state,
                },
            );
        }

        let result = statuses.values().cloned().collect();
        runtime.modules.insert(
            module_id.to_owned(),
            ActiveModule {
                session_token: session_token.to_owned(),
                statuses,
            },
        );
        Ok(result)
    }

    pub fn route(&self, accelerator: &str) -> Result<ShortcutEvent, String> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| "shortcut registry lock poisoned")?;
        let owner = runtime
            .owners
            .get(&accelerator_key(accelerator))
            .ok_or_else(|| format!("shortcut is not registered: {accelerator}"))?;
        let module = runtime
            .modules
            .get(&owner.module_id)
            .ok_or_else(|| "shortcut owner is no longer active".to_owned())?;
        Ok(ShortcutEvent {
            module_id: owner.module_id.clone(),
            shortcut_id: owner.shortcut_id.clone(),
            session_token: module.session_token.clone(),
        })
    }

    pub fn rebind(
        &self,
        module_id: &str,
        shortcut_id: &str,
        accelerator: &str,
    ) -> Result<(), String> {
        validate_runtime_accelerator(accelerator)?;
        let desired_key = accelerator_key(accelerator);
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "shortcut registry lock poisoned")?;
        let current = runtime
            .modules
            .get(module_id)
            .and_then(|module| module.statuses.get(shortcut_id))
            .cloned()
            .ok_or_else(|| format!("shortcut is not declared: {module_id}::{shortcut_id}"))?;
        if let Some(owner) = runtime.owners.get(&desired_key) {
            if owner.module_id != module_id || owner.shortcut_id != shortcut_id {
                return Err(format!(
                    "shortcut accelerator is already in use: {accelerator}"
                ));
            }
        }

        let mut preferences = self.load_preferences()?;
        preferences
            .modules
            .entry(module_id.to_owned())
            .or_default()
            .insert(
                shortcut_id.to_owned(),
                ShortcutPreference {
                    accelerator: Some(accelerator.to_owned()),
                    disabled: false,
                },
            );
        self.save_preferences(&preferences)?;

        release_if_owned(&mut runtime.owners, module_id, shortcut_id, &current);
        runtime.owners.insert(
            desired_key,
            ShortcutOwner {
                module_id: module_id.to_owned(),
                shortcut_id: shortcut_id.to_owned(),
            },
        );
        let status = runtime
            .modules
            .get_mut(module_id)
            .and_then(|module| module.statuses.get_mut(shortcut_id))
            .expect("shortcut existence checked above");
        status.accelerator = Some(accelerator.to_owned());
        status.state = ShortcutState::Registered;
        Ok(())
    }

    pub fn disable(&self, module_id: &str, shortcut_id: &str) -> Result<(), String> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "shortcut registry lock poisoned")?;
        let current = runtime
            .modules
            .get(module_id)
            .and_then(|module| module.statuses.get(shortcut_id))
            .cloned()
            .ok_or_else(|| format!("shortcut is not declared: {module_id}::{shortcut_id}"))?;
        let mut preferences = self.load_preferences()?;
        preferences
            .modules
            .entry(module_id.to_owned())
            .or_default()
            .insert(
                shortcut_id.to_owned(),
                ShortcutPreference {
                    accelerator: None,
                    disabled: true,
                },
            );
        self.save_preferences(&preferences)?;

        release_if_owned(&mut runtime.owners, module_id, shortcut_id, &current);
        let status = runtime
            .modules
            .get_mut(module_id)
            .and_then(|module| module.statuses.get_mut(shortcut_id))
            .expect("shortcut existence checked above");
        status.accelerator = None;
        status.state = ShortcutState::Disabled;
        Ok(())
    }

    pub fn deactivate_module(&self, module_id: &str) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.modules.remove(module_id);
            runtime
                .owners
                .retain(|_, owner| owner.module_id != module_id);
        }
    }

    fn load_preferences(&self) -> Result<PreferenceFile, String> {
        if !self.path.exists() {
            return Ok(PreferenceFile::default());
        }
        let content = fs::read(&self.path)
            .map_err(|error| format!("failed to read shortcut preferences: {error}"))?;
        serde_json::from_slice(&content)
            .map_err(|error| format!("invalid shortcut preferences: {error}"))
    }

    fn save_preferences(&self, preferences: &PreferenceFile) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "shortcut preferences path has no parent".to_owned())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create shortcut preferences directory: {error}"))?;
        let mut temp = NamedTempFile::new_in(parent)
            .map_err(|error| format!("failed to create shortcut preferences file: {error}"))?;
        serde_json::to_writer_pretty(&mut temp, preferences)
            .map_err(|error| format!("failed to encode shortcut preferences: {error}"))?;
        temp.persist(&self.path)
            .map_err(|error| format!("failed to save shortcut preferences: {}", error.error))?;
        Ok(())
    }
}

fn normalize_shortcuts(
    shortcuts: Vec<ShortcutDeclaration>,
) -> Result<Vec<ShortcutDeclaration>, String> {
    Ok(NativeCapabilities {
        shortcuts,
        ..NativeCapabilities::default()
    }
    .normalize()?
    .shortcuts)
}

fn validate_runtime_accelerator(accelerator: &str) -> Result<(), String> {
    normalize_shortcuts(vec![ShortcutDeclaration {
        id: "runtime-binding".into(),
        description: "Runtime shortcut binding".into(),
        accelerator: accelerator.to_owned(),
    }])?;
    Ok(())
}

fn accelerator_key(accelerator: &str) -> String {
    accelerator.trim().to_ascii_lowercase()
}

fn release_if_owned(
    owners: &mut BTreeMap<String, ShortcutOwner>,
    module_id: &str,
    shortcut_id: &str,
    status: &ShortcutStatus,
) {
    if status.state != ShortcutState::Registered {
        return;
    }
    if let Some(accelerator) = &status.accelerator {
        let key = accelerator_key(accelerator);
        if owners
            .get(&key)
            .is_some_and(|owner| owner.module_id == module_id && owner.shortcut_id == shortcut_id)
        {
            owners.remove(&key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::native_capabilities::permissions::ShortcutDeclaration;

    fn shortcut(id: &str, accelerator: &str) -> ShortcutDeclaration {
        ShortcutDeclaration {
            id: id.into(),
            description: format!("Shortcut {id}"),
            accelerator: accelerator.into(),
        }
    }

    #[test]
    fn preserves_first_owner_and_routes_only_registered_shortcut() {
        let temp = tempfile::tempdir().unwrap();
        let registry = ShortcutRegistry::new(temp.path().join("overrides.json"));
        let first = registry
            .activate_module(
                "alpha-module",
                "alpha-token",
                vec![shortcut("show", "Ctrl+Shift+M")],
            )
            .unwrap();
        let second = registry
            .activate_module(
                "beta-module",
                "beta-token",
                vec![shortcut("show", "Ctrl+Shift+M")],
            )
            .unwrap();
        assert_eq!(first[0].state, ShortcutState::Registered);
        assert_eq!(second[0].state, ShortcutState::Conflict);
        let event = registry.route("Ctrl+Shift+M").unwrap();
        assert_eq!(event.module_id, "alpha-module");
        assert_eq!(event.session_token, "alpha-token");
    }

    #[test]
    fn persists_rebinding_and_disabling_then_releases_on_deactivate() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("overrides.json");
        let registry = ShortcutRegistry::new(path.clone());
        registry
            .activate_module(
                "alpha-module",
                "alpha-token",
                vec![
                    shortcut("show", "Ctrl+Shift+M"),
                    shortcut("capture", "Ctrl+Shift+C"),
                ],
            )
            .unwrap();
        registry
            .rebind("alpha-module", "show", "Ctrl+Alt+M")
            .unwrap();
        registry.disable("alpha-module", "capture").unwrap();
        assert!(registry.route("Ctrl+Shift+M").is_err());
        assert_eq!(registry.route("Ctrl+Alt+M").unwrap().shortcut_id, "show");

        let reopened = ShortcutRegistry::new(path);
        let status = reopened
            .activate_module(
                "alpha-module",
                "next-token",
                vec![
                    shortcut("show", "Ctrl+Shift+M"),
                    shortcut("capture", "Ctrl+Shift+C"),
                ],
            )
            .unwrap();
        assert_eq!(
            status
                .iter()
                .find(|item| item.shortcut_id == "show")
                .unwrap()
                .accelerator
                .as_deref(),
            Some("Ctrl+Alt+M")
        );
        assert_eq!(
            status
                .iter()
                .find(|item| item.shortcut_id == "capture")
                .unwrap()
                .state,
            ShortcutState::Disabled
        );
        reopened.deactivate_module("alpha-module");
        assert!(reopened.route("Ctrl+Alt+M").is_err());
    }

    #[test]
    fn failed_rebind_keeps_previous_binding() {
        let temp = tempfile::tempdir().unwrap();
        let registry = ShortcutRegistry::new(temp.path().join("overrides.json"));
        registry
            .activate_module(
                "alpha-module",
                "alpha-token",
                vec![shortcut("show", "Ctrl+Shift+M")],
            )
            .unwrap();
        registry
            .activate_module(
                "beta-module",
                "beta-token",
                vec![shortcut("show", "Ctrl+Alt+B")],
            )
            .unwrap();
        assert!(
            registry
                .rebind("beta-module", "show", "Ctrl+Shift+M")
                .is_err()
        );
        assert_eq!(
            registry.route("Ctrl+Alt+B").unwrap().module_id,
            "beta-module"
        );
    }
}
