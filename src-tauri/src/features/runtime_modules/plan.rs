use std::{collections::BTreeMap, fs, io::Write, path::PathBuf};

use tempfile::NamedTempFile;

use super::{resolver::ResolveResult, types::RuntimeModuleActivationPlan};

pub struct ActivationPlanStore {
    path: PathBuf,
}

impl ActivationPlanStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            path: root.join("activation-plan.json"),
        }
    }

    pub fn load(&self) -> Result<Option<RuntimeModuleActivationPlan>, String> {
        if !self.path.exists() {
            return Ok(None);
        }
        let bytes =
            fs::read(&self.path).map_err(|error| format!("read activation plan: {error}"))?;
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| format!("invalid activation plan: {error}"))
    }

    pub fn commit(
        &self,
        desired_enabled: BTreeMap<String, bool>,
        resolved: ResolveResult,
    ) -> Result<RuntimeModuleActivationPlan, String> {
        let current = self.load()?;
        let plan = RuntimeModuleActivationPlan {
            generation: current
                .as_ref()
                .map_or(1, |plan| plan.generation.saturating_add(1)),
            desired_enabled,
            previous_selected_versions: current
                .as_ref()
                .map(|plan| {
                    if plan.selected_versions == resolved.selected_versions {
                        plan.previous_selected_versions.clone()
                    } else {
                        plan.selected_versions.clone()
                    }
                })
                .unwrap_or_default(),
            selected_versions: resolved.selected_versions,
            activation_order: resolved.activation_order,
            diagnostics: resolved.diagnostics,
        };
        self.write(&plan)?;
        Ok(plan)
    }

    #[cfg(test)]
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    fn write(&self, plan: &RuntimeModuleActivationPlan) -> Result<(), String> {
        let directory = self
            .path
            .parent()
            .ok_or_else(|| "activation plan path has no parent".to_string())?;
        fs::create_dir_all(directory)
            .map_err(|error| format!("create activation plan directory: {error}"))?;
        let mut temporary = NamedTempFile::new_in(directory)
            .map_err(|error| format!("create temporary activation plan: {error}"))?;
        serde_json::to_writer_pretty(&mut temporary, plan)
            .map_err(|error| format!("serialize activation plan: {error}"))?;
        temporary
            .write_all(b"\n")
            .map_err(|error| format!("write activation plan: {error}"))?;
        temporary
            .as_file_mut()
            .sync_all()
            .map_err(|error| format!("flush activation plan: {error}"))?;
        temporary
            .persist(&self.path)
            .map_err(|error| format!("atomically replace activation plan: {}", error.error))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs};

    use super::ActivationPlanStore;
    use crate::features::runtime_modules::resolver::ResolveResult;

    fn resolved(selected: &[(&str, &str)]) -> ResolveResult {
        ResolveResult {
            selected_versions: selected
                .iter()
                .map(|(id, version)| ((*id).into(), (*version).into()))
                .collect(),
            activation_order: selected.iter().map(|(id, _)| (*id).into()).collect(),
            diagnostics: BTreeMap::new(),
            search_nodes: 1,
            limit_reached: false,
        }
    }

    #[test]
    fn atomically_commits_a_monotonic_plan_and_keeps_the_previous_selection() {
        let temp = tempfile::tempdir().unwrap();
        let store = ActivationPlanStore::new(temp.path().join("modules"));
        let desired = BTreeMap::from([("hello-module".into(), true)]);
        let first = store
            .commit(desired.clone(), resolved(&[("hello-module", "1.0.0")]))
            .unwrap();
        let second = store
            .commit(desired, resolved(&[("hello-module", "2.0.0")]))
            .unwrap();

        assert_eq!(first.generation, 1);
        assert_eq!(second.generation, 2);
        assert_eq!(second.previous_selected_versions["hello-module"], "1.0.0");
        assert_eq!(store.load().unwrap().unwrap(), second);
        assert_eq!(
            fs::read_dir(temp.path().join("modules")).unwrap().count(),
            1
        );
    }

    #[test]
    fn an_installed_version_does_not_change_the_plan_before_commit() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("modules");
        let store = ActivationPlanStore::new(root.clone());
        let desired = BTreeMap::from([("hello-module".into(), true)]);
        let first = store
            .commit(desired, resolved(&[("hello-module", "1.0.0")]))
            .unwrap();
        fs::create_dir_all(root.join("hello-module/versions/2.0.0")).unwrap();

        assert_eq!(store.load().unwrap().unwrap(), first);
    }

    #[test]
    fn reports_a_corrupt_plan_instead_of_silently_replacing_it() {
        let temp = tempfile::tempdir().unwrap();
        let store = ActivationPlanStore::new(temp.path().join("modules"));
        fs::create_dir_all(store.path().parent().unwrap()).unwrap();
        fs::write(store.path(), b"{not-json").unwrap();

        let error = store.load().unwrap_err();
        assert!(error.contains("invalid activation plan"));
    }
}
