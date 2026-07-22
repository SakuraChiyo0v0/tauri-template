use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeModuleStatus {
    Active,
    Disabled,
    Waiting,
    Blocked,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeModuleDiagnosticCode {
    MissingDependency,
    IncompatibleDependency,
    DependencyCycle,
    UpstreamActivationFailed,
    ResolutionLimit,
    WaitingPermission,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModuleDiagnostic {
    pub code: RuntimeModuleDiagnosticCode,
    pub module_id: String,
    pub dependency_id: Option<String>,
    pub required_version: Option<String>,
    #[serde(default)]
    pub available_versions: Vec<String>,
    #[serde(default)]
    pub related_modules: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModuleActivationPlan {
    pub generation: u64,
    #[serde(default)]
    pub desired_enabled: BTreeMap<String, bool>,
    #[serde(default)]
    pub selected_versions: BTreeMap<String, String>,
    #[serde(default)]
    pub previous_selected_versions: BTreeMap<String, String>,
    #[serde(default)]
    pub activation_order: Vec<String>,
    #[serde(default)]
    pub diagnostics: BTreeMap<String, Vec<RuntimeModuleDiagnostic>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeModuleImpactCode {
    RequiredByEnabledModules,
    RequiredByInstalledModules,
    RollbackRequiresCoordinatedChange,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModuleImpact {
    pub code: RuntimeModuleImpactCode,
    pub module_id: String,
    #[serde(default)]
    pub related_modules: Vec<String>,
    pub selected_version: Option<String>,
    pub requested_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuntimeModuleCommandError {
    Message { message: String },
    DependencyImpact { impact: RuntimeModuleImpact },
}

impl From<String> for RuntimeModuleCommandError {
    fn from(message: String) -> Self {
        Self::Message { message }
    }
}

#[cfg(test)]
mod tests {
    use super::{RuntimeModuleDiagnosticCode, RuntimeModuleImpactCode};

    #[test]
    fn serializes_stable_diagnostic_and_impact_codes() {
        assert_eq!(
            serde_json::to_string(&RuntimeModuleDiagnosticCode::MissingDependency).unwrap(),
            r#""missing_dependency""#
        );
        assert_eq!(
            serde_json::to_string(&RuntimeModuleImpactCode::RequiredByEnabledModules).unwrap(),
            r#""required_by_enabled_modules""#
        );
    }
}
