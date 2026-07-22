use std::collections::HashSet;

use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;
pub const SDK_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModuleManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub host_version: String,
    pub sdk_version: u32,
    pub entry: String,
    #[serde(default)]
    pub dependencies: RuntimeModuleDependencies,
    #[serde(default)]
    pub navigation: Vec<RuntimeNavigationManifest>,
    #[serde(default)]
    pub settings: Vec<RuntimeSettingManifest>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct RuntimeModuleDependencies {
    #[serde(default)]
    pub required: Vec<RuntimeModuleDependency>,
    #[serde(default)]
    pub optional: Vec<RuntimeModuleDependency>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuntimeModuleDependency {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeNavigationManifest {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub element: String,
    #[serde(default = "default_navigation_group")]
    pub group: String,
    pub order: Option<i32>,
}

fn default_navigation_group() -> String {
    "main".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum RuntimeSettingManifest {
    Switch {
        id: String,
        label: String,
        description: Option<String>,
        group: String,
        order: Option<i32>,
        #[serde(rename = "defaultValue")]
        default_value: bool,
    },
    Select {
        id: String,
        label: String,
        description: Option<String>,
        group: String,
        order: Option<i32>,
        #[serde(rename = "defaultValue")]
        default_value: String,
        options: Vec<RuntimeSelectOption>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuntimeSelectOption {
    pub label: String,
    pub value: String,
}

impl RuntimeModuleManifest {
    pub fn parse_and_validate(bytes: &[u8], host_version: &Version) -> Result<Self, String> {
        let manifest: Self = serde_json::from_slice(bytes)
            .map_err(|error| format!("invalid module manifest JSON: {error}"))?;
        manifest.validate(host_version)?;
        Ok(manifest)
    }

    pub fn validate(&self, host_version: &Version) -> Result<(), String> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(format!(
                "unsupported module schema version: {}",
                self.schema_version
            ));
        }
        if self.sdk_version != SDK_VERSION {
            return Err(format!(
                "unsupported module SDK version: {}",
                self.sdk_version
            ));
        }
        if !is_module_id(&self.id) || matches!(self.id.as_str(), "system" | "logging") {
            return Err(format!("invalid or reserved module id: {}", self.id));
        }
        validate_text(&self.name, "module name", 200)?;
        validate_text(&self.description, "module description", 500)?;
        Version::parse(&self.version)
            .map_err(|error| format!("invalid module version: {error}"))?;
        let host_requirement = VersionReq::parse(&self.host_version)
            .map_err(|error| format!("invalid host version requirement: {error}"))?;
        if !host_requirement.matches(host_version) {
            return Err(format!(
                "module requires host version {}, current host is {}",
                self.host_version, host_version
            ));
        }
        if self.entry != "index.js" {
            return Err("V1 module entry must be index.js".into());
        }

        let mut dependency_ids = HashSet::new();
        for dependency in self
            .dependencies
            .required
            .iter()
            .chain(self.dependencies.optional.iter())
        {
            if !is_module_id(&dependency.id)
                || matches!(dependency.id.as_str(), "system" | "logging")
                || dependency.id == self.id
                || !dependency_ids.insert(&dependency.id)
            {
                return Err(format!(
                    "invalid, self, or duplicate dependency id: {}",
                    dependency.id
                ));
            }
            VersionReq::parse(&dependency.version).map_err(|error| {
                format!(
                    "invalid dependency version requirement for {}: {error}",
                    dependency.id
                )
            })?;
        }

        let mut navigation_ids = HashSet::new();
        let mut elements = HashSet::new();
        for navigation in &self.navigation {
            if !is_contribution_id(&navigation.id) || !navigation_ids.insert(&navigation.id) {
                return Err(format!(
                    "invalid or duplicate navigation id: {}",
                    navigation.id
                ));
            }
            validate_text(&navigation.title, "navigation title", 200)?;
            if let Some(description) = &navigation.description {
                validate_text(description, "navigation description", 500)?;
            }
            if navigation.group != "main" && navigation.group != "system" {
                return Err(format!("invalid navigation group: {}", navigation.group));
            }
            if !navigation.element.starts_with(&format!("{}-", self.id))
                || !is_module_id(&navigation.element)
                || !elements.insert(&navigation.element)
            {
                return Err(format!(
                    "invalid, duplicate, or unnamespaced custom element: {}",
                    navigation.element
                ));
            }
        }

        let mut setting_ids = HashSet::new();
        for setting in &self.settings {
            let (id, label, description, group) = match setting {
                RuntimeSettingManifest::Switch {
                    id,
                    label,
                    description,
                    group,
                    ..
                }
                | RuntimeSettingManifest::Select {
                    id,
                    label,
                    description,
                    group,
                    ..
                } => (id, label, description, group),
            };
            if !is_contribution_id(id) || !setting_ids.insert(id) {
                return Err(format!("invalid or duplicate setting id: {id}"));
            }
            validate_text(label, "setting label", 200)?;
            validate_text(group, "setting group", 64)?;
            if let Some(description) = description {
                validate_text(description, "setting description", 500)?;
            }
            if let RuntimeSettingManifest::Select {
                default_value,
                options,
                ..
            } = setting
                && (options.is_empty()
                    || !options.iter().any(|option| &option.value == default_value)
                    || options.iter().any(|option| {
                        validate_text(&option.label, "select option label", 200).is_err()
                            || validate_text(&option.value, "select option value", 200).is_err()
                    }))
            {
                return Err(format!("invalid select setting options for {id}"));
            }
        }
        Ok(())
    }
}

fn validate_text(value: &str, label: &str, max_length: usize) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > max_length {
        return Err(format!(
            "{label} must be a non-empty string up to {max_length} bytes"
        ));
    }
    Ok(())
}

pub fn is_module_id(value: &str) -> bool {
    if value.len() < 3 || value.len() > 64 || !value.contains('-') {
        return false;
    }
    value.split('-').all(|segment| {
        !segment.is_empty()
            && segment.chars().enumerate().all(|(index, character)| {
                character.is_ascii_lowercase() || (index > 0 && character.is_ascii_digit())
            })
    })
}

fn is_contribution_id(value: &str) -> bool {
    (2..=64).contains(&value.len())
        && value.chars().enumerate().all(|(index, character)| {
            character.is_ascii_alphabetic()
                || (index > 0
                    && (character.is_ascii_digit() || matches!(character, '.' | '_' | '-')))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> RuntimeModuleManifest {
        RuntimeModuleManifest {
            schema_version: 1,
            id: "hello-module".into(),
            name: "Hello Module".into(),
            description: "Runtime module used by tests".into(),
            version: "1.2.0".into(),
            host_version: ">=0.1.0, <0.2.0".into(),
            sdk_version: 1,
            entry: "index.js".into(),
            dependencies: RuntimeModuleDependencies::default(),
            navigation: vec![RuntimeNavigationManifest {
                id: "hello-home".into(),
                title: "Hello".into(),
                description: None,
                element: "hello-module-home".into(),
                group: "main".into(),
                order: Some(10),
            }],
            settings: vec![],
        }
    }

    #[test]
    fn accepts_a_valid_manifest() {
        assert!(manifest().validate(&Version::new(0, 1, 0)).is_ok());
    }

    fn manifest_with_dependencies(dependencies: serde_json::Value) -> Vec<u8> {
        let mut value = serde_json::to_value(manifest()).unwrap();
        value["dependencies"] = dependencies;
        serde_json::to_vec(&value).unwrap()
    }

    #[test]
    fn treats_a_legacy_manifest_as_dependency_free() {
        let parsed = RuntimeModuleManifest::parse_and_validate(
            &serde_json::to_vec(&manifest()).unwrap(),
            &Version::new(0, 1, 0),
        )
        .unwrap();
        let serialized = serde_json::to_value(parsed).unwrap();
        assert_eq!(
            serialized["dependencies"]["required"],
            serde_json::json!([])
        );
        assert_eq!(
            serialized["dependencies"]["optional"],
            serde_json::json!([])
        );
    }

    #[test]
    fn preserves_required_and_optional_dependencies() {
        let parsed = RuntimeModuleManifest::parse_and_validate(
            &manifest_with_dependencies(serde_json::json!({
                "required": [{ "id": "data-provider", "version": "^1.2.0" }],
                "optional": [{ "id": "export-tools", "version": ">=1.0.0, <2.0.0" }]
            })),
            &Version::new(0, 1, 0),
        )
        .unwrap();
        let serialized = serde_json::to_value(parsed).unwrap();
        assert_eq!(
            serialized["dependencies"]["required"][0]["id"],
            "data-provider"
        );
        assert_eq!(
            serialized["dependencies"]["optional"][0]["id"],
            "export-tools"
        );
    }

    #[test]
    fn rejects_self_duplicate_and_invalid_dependency_ranges() {
        for dependencies in [
            serde_json::json!({
                "required": [{ "id": "hello-module", "version": "^1.0.0" }]
            }),
            serde_json::json!({
                "required": [{ "id": "data-provider", "version": "^1.0.0" }],
                "optional": [{ "id": "data-provider", "version": "^1.0.0" }]
            }),
            serde_json::json!({
                "required": [{ "id": "data-provider", "version": "not a range!" }]
            }),
        ] {
            let error = RuntimeModuleManifest::parse_and_validate(
                &manifest_with_dependencies(dependencies),
                &Version::new(0, 1, 0),
            )
            .unwrap_err();
            assert!(error.contains("depend"), "unexpected error: {error}");
        }
    }

    #[test]
    fn rejects_incompatible_host_version() {
        let error = manifest().validate(&Version::new(0, 2, 0)).unwrap_err();
        assert!(error.contains("requires host version"));
    }

    #[test]
    fn rejects_unnamespaced_elements() {
        let mut value = manifest();
        value.navigation[0].element = "other-module-home".into();
        assert!(
            value
                .validate(&Version::new(0, 1, 0))
                .unwrap_err()
                .contains("custom element")
        );
    }

    #[test]
    fn rejects_reserved_module_ids() {
        let mut value = manifest();
        value.id = "system".into();
        assert!(
            value
                .validate(&Version::new(0, 1, 0))
                .unwrap_err()
                .contains("module id")
        );
    }
}
