use std::collections::HashSet;

use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};

use crate::features::native_capabilities::permissions::{
    NativeCapabilities, NormalizedNativeCapabilities,
};

pub const SCHEMA_VERSION: u32 = 2;
pub const MIN_SDK_VERSION: u32 = 2;
pub const MAX_SDK_VERSION: u32 = 12;

pub fn supports_database_api(sdk_version: u32) -> bool {
    (MIN_SDK_VERSION..=MAX_SDK_VERSION).contains(&sdk_version)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct LocalizedText {
    #[serde(rename = "zh-CN")]
    pub zh_cn: String,
    pub en: String,
}

impl LocalizedText {
    pub fn validate(&self, label: &str, max_length: usize) -> Result<(), String> {
        validate_text(&self.zh_cn, &format!("{label}.zh-CN"), max_length)?;
        validate_text(&self.en, &format!("{label}.en"), max_length)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModuleManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: LocalizedText,
    pub description: LocalizedText,
    pub version: String,
    pub host_version: String,
    pub sdk_version: u32,
    pub entry: String,
    #[serde(default)]
    pub dependencies: RuntimeModuleDependencies,
    #[serde(default)]
    pub services: RuntimeModuleServices,
    #[serde(default)]
    pub events: RuntimeModuleEvents,
    #[serde(default)]
    pub navigation: Vec<RuntimeNavigationManifest>,
    #[serde(default)]
    pub settings: Vec<RuntimeSettingManifest>,
    #[serde(default)]
    pub native_capabilities: NativeCapabilities,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct RuntimeModuleServices {
    #[serde(default)]
    pub provides: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct RuntimeModuleEvents {
    #[serde(default)]
    pub publishes: Vec<String>,
    #[serde(default)]
    pub subscribes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeNavigationManifest {
    pub id: String,
    pub title: LocalizedText,
    pub description: Option<LocalizedText>,
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
        label: LocalizedText,
        description: Option<LocalizedText>,
        group: String,
        order: Option<i32>,
        #[serde(rename = "defaultValue")]
        default_value: bool,
    },
    Select {
        id: String,
        label: LocalizedText,
        description: Option<LocalizedText>,
        group: String,
        order: Option<i32>,
        #[serde(rename = "defaultValue")]
        default_value: String,
        options: Vec<RuntimeSelectOption>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuntimeSelectOption {
    pub label: LocalizedText,
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
        if !(MIN_SDK_VERSION..=MAX_SDK_VERSION).contains(&self.sdk_version) {
            return Err(format!(
                "unsupported module SDK version: {}",
                self.sdk_version
            ));
        }
        if !is_module_id(&self.id) || matches!(self.id.as_str(), "system" | "logging") {
            return Err(format!("invalid or reserved module id: {}", self.id));
        }
        self.name.validate("module name", 200)?;
        self.description.validate("module description", 500)?;
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
            return Err("runtime module entry must be index.js".into());
        }
        if self.sdk_version < 3 && self.native_capabilities != NativeCapabilities::default() {
            return Err("native capabilities require Host SDK V3".into());
        }
        if self.sdk_version < 5 && self.native_capabilities.module_repository.is_some() {
            return Err("module repository access requires Host SDK V5".into());
        }
        if self.sdk_version < 8 && self.native_capabilities.notifications.is_some() {
            return Err("module notifications require Host SDK V8".into());
        }
        if self.sdk_version < 10 && self.native_capabilities.clipboard.is_some() {
            return Err("module clipboard access requires Host SDK V10".into());
        }
        if self.sdk_version < 12 && self.native_capabilities.http.is_some() {
            return Err("module http proxy requires Host SDK V12".into());
        }
        self.native_capabilities.normalize()?;

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

        if self.sdk_version < 4 && !self.services.provides.is_empty() {
            return Err("module services require Host SDK V4".into());
        }
        let mut service_ids = HashSet::new();
        for service_id in &self.services.provides {
            if !is_service_id(service_id) || !service_ids.insert(service_id) {
                return Err(format!("invalid or duplicate service id: {service_id}"));
            }
        }

        if self.sdk_version < 7
            && (!self.events.publishes.is_empty() || !self.events.subscribes.is_empty())
        {
            return Err("module events require Host SDK V7".into());
        }
        let mut published_event_ids = HashSet::new();
        for event_id in &self.events.publishes {
            if !is_service_id(event_id) || !published_event_ids.insert(event_id) {
                return Err(format!("invalid or duplicate event id: {event_id}"));
            }
        }
        let mut subscribed_event_ids = HashSet::new();
        for event_id in &self.events.subscribes {
            if !is_service_id(event_id) || !subscribed_event_ids.insert(event_id) {
                return Err(format!("invalid or duplicate event id: {event_id}"));
            }
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
            navigation.title.validate("navigation title", 200)?;
            if let Some(description) = &navigation.description {
                description.validate("navigation description", 500)?;
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
            label.validate("setting label", 200)?;
            validate_text(group, "setting group", 64)?;
            if let Some(description) = description {
                description.validate("setting description", 500)?;
            }
            if let RuntimeSettingManifest::Select {
                default_value,
                options,
                ..
            } = setting
                && (options.is_empty()
                    || !options.iter().any(|option| &option.value == default_value)
                    || options.iter().any(|option| {
                        option.label.validate("select option label", 200).is_err()
                            || validate_text(&option.value, "select option value", 200).is_err()
                    }))
            {
                return Err(format!("invalid select setting options for {id}"));
            }
        }
        Ok(())
    }

    pub fn normalized_native_capabilities(&self) -> Result<NormalizedNativeCapabilities, String> {
        self.native_capabilities.normalize()
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

fn is_service_id(value: &str) -> bool {
    (3..=64).contains(&value.len())
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
        && (value.contains('.') || value.contains('-'))
        && value.split(['.', '-']).all(|segment| {
            !segment.is_empty()
                && segment
                    .chars()
                    .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        })
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

    fn manifest() -> RuntimeModuleManifest {
        RuntimeModuleManifest {
            schema_version: 2,
            id: "hello-module".into(),
            name: text("问候模块", "Hello Module"),
            description: text("测试运行时模块", "Runtime module used by tests"),
            version: "1.2.0".into(),
            host_version: ">=0.1.0, <0.2.0".into(),
            sdk_version: 2,
            entry: "index.js".into(),
            dependencies: RuntimeModuleDependencies::default(),
            services: RuntimeModuleServices::default(),
            events: RuntimeModuleEvents::default(),
            navigation: vec![RuntimeNavigationManifest {
                id: "hello-home".into(),
                title: text("问候", "Hello"),
                description: None,
                element: "hello-module-home".into(),
                group: "main".into(),
                order: Some(10),
            }],
            settings: vec![],
            native_capabilities: NativeCapabilities::default(),
        }
    }

    #[test]
    fn accepts_a_valid_manifest() {
        assert!(manifest().validate(&Version::new(0, 1, 0)).is_ok());
    }

    #[test]
    fn rejects_schema_v1_and_sdk_v1() {
        let mut value = manifest();
        value.schema_version = 1;
        assert!(value.validate(&Version::new(0, 1, 0)).is_err());
        value.schema_version = 2;
        value.sdk_version = 1;
        assert!(value.validate(&Version::new(0, 1, 0)).is_err());
    }

    #[test]
    fn accepts_sdk_v2_through_v12_but_rejects_other_versions() {
        let mut value = manifest();
        for version in 3..=12 {
            value.sdk_version = version;
            assert!(value.validate(&Version::new(0, 1, 0)).is_ok(), "SDK {version} should be valid");
        }
        value.sdk_version = 1;
        assert!(value.validate(&Version::new(0, 1, 0)).is_err());
        value.sdk_version = 13;
        assert!(
            value
                .validate(&Version::new(0, 1, 0))
                .unwrap_err()
                .contains("SDK version")
        );
    }

    #[test]
    fn accepts_module_repository_access_only_on_sdk_v5() {
        let mut value = serde_json::to_value(manifest()).unwrap();
        value["sdkVersion"] = serde_json::json!(5);
        value["nativeCapabilities"] = serde_json::json!({
            "filesystem": { "private": false, "external": ["read", "list"] },
            "registry": [],
            "tray": [],
            "shortcuts": [],
            "moduleRepository": { "install": true }
        });
        let parsed = RuntimeModuleManifest::parse_and_validate(
            &serde_json::to_vec(&value).unwrap(),
            &Version::new(0, 1, 0),
        )
        .unwrap();
        assert!(parsed.native_capabilities.module_repository.is_some());

        value["sdkVersion"] = serde_json::json!(6);
        let parsed = RuntimeModuleManifest::parse_and_validate(
            &serde_json::to_vec(&value).unwrap(),
            &Version::new(0, 1, 0),
        )
        .unwrap();
        assert_eq!(parsed.sdk_version, 6);

        value["sdkVersion"] = serde_json::json!(4);
        assert!(
            RuntimeModuleManifest::parse_and_validate(
                &serde_json::to_vec(&value).unwrap(),
                &Version::new(0, 1, 0),
            )
            .unwrap_err()
            .contains("Host SDK V5")
        );
    }

    #[test]
    fn accepts_declared_services_on_v4_and_rejects_invalid_or_older_declarations() {
        let mut value = serde_json::to_value(manifest()).unwrap();
        value["sdkVersion"] = serde_json::json!(4);
        value["services"] = serde_json::json!({ "provides": ["notes.v1"] });
        let parsed = RuntimeModuleManifest::parse_and_validate(
            &serde_json::to_vec(&value).unwrap(),
            &Version::new(0, 1, 0),
        )
        .unwrap();
        assert_eq!(parsed.services.provides, vec!["notes.v1"]);

        value["sdkVersion"] = serde_json::json!(3);
        assert!(
            RuntimeModuleManifest::parse_and_validate(
                &serde_json::to_vec(&value).unwrap(),
                &Version::new(0, 1, 0),
            )
            .unwrap_err()
            .contains("service")
        );

        value["sdkVersion"] = serde_json::json!(4);
        value["services"] = serde_json::json!({ "provides": ["notes.v1", "notes.v1"] });
        assert!(
            RuntimeModuleManifest::parse_and_validate(
                &serde_json::to_vec(&value).unwrap(),
                &Version::new(0, 1, 0),
            )
            .unwrap_err()
            .contains("service")
        );
    }

    #[test]
    fn rejects_missing_or_blank_translations() {
        let mut value = serde_json::to_value(manifest()).unwrap();
        value["name"] = serde_json::json!({ "zh-CN": "问候模块" });
        assert!(
            RuntimeModuleManifest::parse_and_validate(
                &serde_json::to_vec(&value).unwrap(),
                &Version::new(0, 1, 0),
            )
            .is_err()
        );

        value = serde_json::to_value(manifest()).unwrap();
        value["navigation"][0]["title"]["en"] = serde_json::json!("  ");
        let error = RuntimeModuleManifest::parse_and_validate(
            &serde_json::to_vec(&value).unwrap(),
            &Version::new(0, 1, 0),
        )
        .unwrap_err();
        assert!(error.contains("navigation title.en"));
    }

    #[test]
    fn accepts_sdk_v3_with_native_capabilities_and_rejects_them_on_v2() {
        let mut value = serde_json::to_value(manifest()).unwrap();
        value["sdkVersion"] = serde_json::json!(3);
        value["nativeCapabilities"] = serde_json::json!({
            "filesystem": { "private": true, "external": ["read"] },
            "process": { "urlSchemes": ["https"], "executableGrants": false },
            "registry": [],
            "tray": [],
            "shortcuts": []
        });
        let parsed = RuntimeModuleManifest::parse_and_validate(
            &serde_json::to_vec(&value).unwrap(),
            &Version::new(0, 1, 0),
        )
        .unwrap();
        assert_eq!(parsed.sdk_version, 3);
        assert!(parsed.native_capabilities.filesystem.unwrap().private);

        value["sdkVersion"] = serde_json::json!(2);
        assert!(
            RuntimeModuleManifest::parse_and_validate(
                &serde_json::to_vec(&value).unwrap(),
                &Version::new(0, 1, 0),
            )
            .unwrap_err()
            .contains("native capabilities")
        );
    }

    fn manifest_with_dependencies(dependencies: serde_json::Value) -> Vec<u8> {
        let mut value = serde_json::to_value(manifest()).unwrap();
        value["dependencies"] = dependencies;
        serde_json::to_vec(&value).unwrap()
    }

    #[test]
    fn treats_an_omitted_dependency_block_as_dependency_free() {
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

    #[test]
    fn accepts_sdk_v7_with_declared_events() {
        let mut value = serde_json::to_value(manifest()).unwrap();
        value["sdkVersion"] = serde_json::json!(7);
        value["events"] = serde_json::json!({
            "publishes": ["notes.changed.v1"],
            "subscribes": ["notes.changed.v1", "market.updated.v1"]
        });
        let parsed = RuntimeModuleManifest::parse_and_validate(
            &serde_json::to_vec(&value).unwrap(),
            &Version::new(0, 1, 0),
        )
        .unwrap();
        assert_eq!(parsed.sdk_version, 7);
        assert_eq!(parsed.events.publishes, vec!["notes.changed.v1"]);
        assert_eq!(
            parsed.events.subscribes,
            vec!["notes.changed.v1", "market.updated.v1"]
        );
    }

    #[test]
    fn rejects_event_declarations_below_sdk_v7() {
        let mut value = serde_json::to_value(manifest()).unwrap();
        value["sdkVersion"] = serde_json::json!(6);
        value["events"] = serde_json::json!({ "publishes": ["notes.changed.v1"] });
        assert!(
            RuntimeModuleManifest::parse_and_validate(
                &serde_json::to_vec(&value).unwrap(),
                &Version::new(0, 1, 0),
            )
            .unwrap_err()
            .contains("Host SDK V7")
        );
    }

    #[test]
    fn rejects_duplicate_or_invalid_event_ids() {
        for events in [
            serde_json::json!({ "publishes": ["notes.changed.v1", "notes.changed.v1"] }),
            serde_json::json!({ "subscribes": ["Invalid Event"] }),
            serde_json::json!({ "subscribes": ["plainword"] }),
        ] {
            let mut value = serde_json::to_value(manifest()).unwrap();
            value["sdkVersion"] = serde_json::json!(7);
            value["events"] = events.clone();
            assert!(
                RuntimeModuleManifest::parse_and_validate(
                    &serde_json::to_vec(&value).unwrap(),
                    &Version::new(0, 1, 0),
                )
                .unwrap_err()
                .contains("event id"),
                "expected event id rejection for {events}"
            );
        }
    }

    #[test]
    fn supports_database_api_for_every_supported_sdk_version() {
        for sdk_version in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] {
            assert_eq!(
                supports_database_api(sdk_version),
                (2..=12).contains(&sdk_version),
                "unexpected database support for SDK {sdk_version}"
            );
        }
    }
}
