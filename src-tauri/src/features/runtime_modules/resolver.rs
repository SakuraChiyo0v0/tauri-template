use std::collections::{BTreeMap, BTreeSet};

use semver::{Version, VersionReq};

use super::{manifest::RuntimeModuleManifest, types::RuntimeModuleDiagnostic};

#[derive(Debug, Clone)]
pub struct ResolveRequest {
    pub catalog: BTreeMap<String, Vec<RuntimeModuleManifest>>,
    pub desired_enabled: BTreeSet<String>,
    pub current_selected: BTreeMap<String, String>,
    pub preferred: Option<(String, String)>,
    pub max_search_nodes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolveResult {
    pub selected_versions: BTreeMap<String, String>,
    pub activation_order: Vec<String>,
    pub diagnostics: BTreeMap<String, Vec<RuntimeModuleDiagnostic>>,
    pub search_nodes: usize,
    pub limit_reached: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Score {
    selected_count: usize,
    preferred_match: bool,
    current_matches: usize,
}

struct Search<'a> {
    request: &'a ResolveRequest,
    ids: Vec<String>,
    candidates: BTreeMap<String, Vec<RuntimeModuleManifest>>,
    nodes: usize,
    limit_reached: bool,
    best: Option<(Score, BTreeMap<String, RuntimeModuleManifest>, Vec<String>)>,
}

pub fn resolve(request: &ResolveRequest) -> ResolveResult {
    let ids = request.desired_enabled.iter().cloned().collect::<Vec<_>>();
    let candidates = ids
        .iter()
        .map(|id| (id.clone(), ordered_candidates(request, id)))
        .collect();
    let mut search = Search {
        request,
        ids,
        candidates,
        nodes: 0,
        limit_reached: false,
        best: None,
    };
    search.visit(0, &mut BTreeMap::new());

    let current_assignment = assignment_for_versions(request, &request.current_selected);
    let current_valid = current_assignment.as_ref().and_then(|assignment| {
        activation_order(assignment).map(|order| (assignment.clone(), order))
    });

    let (selected, activation_order) = if search.limit_reached {
        current_valid
            .or_else(|| {
                search
                    .best
                    .as_ref()
                    .map(|(_, assignment, order)| (assignment.clone(), order.clone()))
            })
            .unwrap_or_default()
    } else {
        search
            .best
            .as_ref()
            .map(|(_, assignment, order)| (assignment.clone(), order.clone()))
            .unwrap_or_default()
    };
    let selected_versions = selected
        .iter()
        .map(|(id, manifest)| (id.clone(), manifest.version.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut diagnostics = build_diagnostics(request, &selected);
    if search.limit_reached {
        let module_id = request
            .preferred
            .as_ref()
            .map(|(id, _)| id.clone())
            .or_else(|| request.desired_enabled.iter().next().cloned())
            .unwrap_or_else(|| "runtime-modules".into());
        diagnostics
            .entry(module_id.clone())
            .or_default()
            .push(RuntimeModuleDiagnostic {
                code: super::types::RuntimeModuleDiagnosticCode::ResolutionLimit,
                module_id,
                dependency_id: None,
                required_version: None,
                available_versions: Vec::new(),
                related_modules: Vec::new(),
            });
    }

    ResolveResult {
        selected_versions,
        activation_order,
        diagnostics,
        search_nodes: search.nodes,
        limit_reached: search.limit_reached,
    }
}

impl Search<'_> {
    fn visit(&mut self, index: usize, assignment: &mut BTreeMap<String, RuntimeModuleManifest>) {
        if self.nodes >= self.request.max_search_nodes {
            self.limit_reached = true;
            return;
        }
        self.nodes += 1;

        if index == self.ids.len() {
            let Some(order) = activation_order(assignment) else {
                return;
            };
            let score = self.score(assignment);
            if self.best.as_ref().is_none_or(|(best, _, _)| score > *best) {
                self.best = Some((score, assignment.clone(), order));
            }
            return;
        }

        if let Some((score, _, _)) = &self.best
            && assignment.len() + (self.ids.len() - index) < score.selected_count
        {
            return;
        }

        let id = self.ids[index].clone();
        let candidates = self.candidates.get(&id).cloned().unwrap_or_default();
        for candidate in candidates {
            assignment.insert(id.clone(), candidate);
            self.visit(index + 1, assignment);
            assignment.remove(&id);
            if self.limit_reached {
                return;
            }
        }
        self.visit(index + 1, assignment);
    }

    fn score(&self, assignment: &BTreeMap<String, RuntimeModuleManifest>) -> Score {
        let preferred_match = self
            .request
            .preferred
            .as_ref()
            .is_some_and(|(id, version)| {
                assignment
                    .get(id)
                    .is_some_and(|manifest| manifest.version == *version)
            });
        let current_matches = self
            .request
            .current_selected
            .iter()
            .filter(|(id, version)| {
                assignment
                    .get(*id)
                    .is_some_and(|manifest| manifest.version == **version)
            })
            .count();
        Score {
            selected_count: assignment.len(),
            preferred_match,
            current_matches,
        }
    }
}

fn ordered_candidates(request: &ResolveRequest, id: &str) -> Vec<RuntimeModuleManifest> {
    let mut candidates = request.catalog.get(id).cloned().unwrap_or_default();
    candidates.sort_by(|left, right| {
        Version::parse(&right.version)
            .ok()
            .cmp(&Version::parse(&left.version).ok())
            .then_with(|| right.version.cmp(&left.version))
    });
    candidates.sort_by_key(|manifest| {
        if request
            .preferred
            .as_ref()
            .is_some_and(|(preferred_id, version)| {
                preferred_id == id && version == &manifest.version
            })
        {
            0
        } else if request.current_selected.get(id) == Some(&manifest.version) {
            1
        } else {
            2
        }
    });
    candidates
}

fn assignment_for_versions(
    request: &ResolveRequest,
    versions: &BTreeMap<String, String>,
) -> Option<BTreeMap<String, RuntimeModuleManifest>> {
    let mut assignment = BTreeMap::new();
    for (id, version) in versions {
        if !request.desired_enabled.contains(id) {
            continue;
        }
        let manifest = request
            .catalog
            .get(id)?
            .iter()
            .find(|manifest| &manifest.version == version)?
            .clone();
        assignment.insert(id.clone(), manifest);
    }
    Some(assignment)
}

fn activation_order(assignment: &BTreeMap<String, RuntimeModuleManifest>) -> Option<Vec<String>> {
    let mut outgoing = assignment
        .keys()
        .map(|id| (id.clone(), BTreeSet::<String>::new()))
        .collect::<BTreeMap<_, _>>();
    let mut incoming = assignment
        .keys()
        .map(|id| (id.clone(), 0_usize))
        .collect::<BTreeMap<_, _>>();

    for (consumer_id, manifest) in assignment {
        for dependency in &manifest.dependencies.required {
            let provider = assignment.get(&dependency.id)?;
            if !matches_version(&provider.version, &dependency.version) {
                return None;
            }
            if outgoing
                .get_mut(&dependency.id)
                .expect("selected provider must have an edge set")
                .insert(consumer_id.clone())
            {
                *incoming.get_mut(consumer_id).expect("selected consumer") += 1;
            }
        }
        for dependency in &manifest.dependencies.optional {
            let Some(provider) = assignment.get(&dependency.id) else {
                continue;
            };
            if matches_version(&provider.version, &dependency.version)
                && outgoing
                    .get_mut(&dependency.id)
                    .expect("selected provider must have an edge set")
                    .insert(consumer_id.clone())
            {
                *incoming.get_mut(consumer_id).expect("selected consumer") += 1;
            }
        }
    }

    let mut ready = incoming
        .iter()
        .filter(|(_, count)| **count == 0)
        .map(|(id, _)| id.clone())
        .collect::<BTreeSet<_>>();
    let mut order = Vec::with_capacity(assignment.len());
    while let Some(id) = ready.pop_first() {
        order.push(id.clone());
        for consumer in &outgoing[&id] {
            let count = incoming.get_mut(consumer).expect("selected consumer");
            *count -= 1;
            if *count == 0 {
                ready.insert(consumer.clone());
            }
        }
    }
    (order.len() == assignment.len()).then_some(order)
}

fn matches_version(version: &str, requirement: &str) -> bool {
    Version::parse(version)
        .ok()
        .zip(VersionReq::parse(requirement).ok())
        .is_some_and(|(version, requirement)| requirement.matches(&version))
}

fn build_diagnostics(
    request: &ResolveRequest,
    selected: &BTreeMap<String, RuntimeModuleManifest>,
) -> BTreeMap<String, Vec<RuntimeModuleDiagnostic>> {
    use super::types::RuntimeModuleDiagnosticCode::{
        DependencyCycle, IncompatibleDependency, MissingDependency,
    };

    let representative = request
        .desired_enabled
        .iter()
        .filter_map(|id| {
            ordered_candidates(request, id)
                .into_iter()
                .next()
                .map(|manifest| (id.clone(), manifest))
        })
        .collect::<BTreeMap<_, _>>();
    let cycles = cycle_paths(&representative);
    let mut diagnostics = BTreeMap::<String, Vec<RuntimeModuleDiagnostic>>::new();

    for id in &request.desired_enabled {
        if selected.contains_key(id) {
            continue;
        }
        if let Some(path) = cycles.get(id) {
            diagnostics
                .entry(id.clone())
                .or_default()
                .push(RuntimeModuleDiagnostic {
                    code: DependencyCycle,
                    module_id: id.clone(),
                    dependency_id: None,
                    required_version: None,
                    available_versions: Vec::new(),
                    related_modules: path.clone(),
                });
            continue;
        }

        let Some(manifest) = representative.get(id) else {
            continue;
        };
        let issue = manifest
            .dependencies
            .required
            .iter()
            .find_map(|dependency| {
                let mut available_versions = request
                    .catalog
                    .get(&dependency.id)
                    .into_iter()
                    .flatten()
                    .map(|manifest| manifest.version.clone())
                    .collect::<Vec<_>>();
                available_versions.sort_by(|left, right| {
                    Version::parse(right).ok().cmp(&Version::parse(left).ok())
                });
                let selected_compatible = selected.get(&dependency.id).is_some_and(|provider| {
                    matches_version(&provider.version, &dependency.version)
                });
                (!selected_compatible).then(|| RuntimeModuleDiagnostic {
                    code: if available_versions.is_empty()
                        || !request.desired_enabled.contains(&dependency.id)
                    {
                        MissingDependency
                    } else {
                        IncompatibleDependency
                    },
                    module_id: id.clone(),
                    dependency_id: Some(dependency.id.clone()),
                    required_version: Some(dependency.version.clone()),
                    available_versions,
                    related_modules: Vec::new(),
                })
            });
        if let Some(issue) = issue {
            diagnostics.entry(id.clone()).or_default().push(issue);
        }
    }
    diagnostics
}

fn cycle_paths(
    assignment: &BTreeMap<String, RuntimeModuleManifest>,
) -> BTreeMap<String, Vec<String>> {
    let mut state = BTreeMap::<String, u8>::new();
    let mut stack = Vec::<String>::new();
    let mut paths = BTreeMap::<String, Vec<String>>::new();
    for id in assignment.keys() {
        find_cycles(id, assignment, &mut state, &mut stack, &mut paths);
    }
    paths
}

fn find_cycles(
    id: &str,
    assignment: &BTreeMap<String, RuntimeModuleManifest>,
    state: &mut BTreeMap<String, u8>,
    stack: &mut Vec<String>,
    paths: &mut BTreeMap<String, Vec<String>>,
) {
    match state.get(id).copied().unwrap_or_default() {
        1 => {
            if let Some(start) = stack.iter().position(|entry| entry == id) {
                let mut path = stack[start..].to_vec();
                path.push(id.to_string());
                for member in &path[..path.len() - 1] {
                    paths.insert(member.clone(), path.clone());
                }
            }
            return;
        }
        2 => return,
        _ => {}
    }
    state.insert(id.to_string(), 1);
    stack.push(id.to_string());
    if let Some(manifest) = assignment.get(id) {
        let mut dependencies = manifest
            .dependencies
            .required
            .iter()
            .filter(|dependency| {
                assignment
                    .get(&dependency.id)
                    .is_some_and(|provider| matches_version(&provider.version, &dependency.version))
            })
            .map(|dependency| dependency.id.clone())
            .collect::<Vec<_>>();
        dependencies.sort();
        for dependency in dependencies {
            find_cycles(&dependency, assignment, state, stack, paths);
        }
    }
    stack.pop();
    state.insert(id.to_string(), 2);
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::{ResolveRequest, resolve};
    use crate::features::runtime_modules::{
        manifest::{LocalizedText, RuntimeModuleDependencies, RuntimeModuleDependency, RuntimeModuleManifest},
        types::RuntimeModuleDiagnosticCode,
    };

    fn module(
        id: &str,
        version: &str,
        required: &[(&str, &str)],
        optional: &[(&str, &str)],
    ) -> RuntimeModuleManifest {
        RuntimeModuleManifest {
            schema_version: 2,
            id: id.into(),
            name: LocalizedText { zh_cn: id.into(), en: id.into() },
            description: LocalizedText {
                zh_cn: format!("{id} 测试模块"),
                en: format!("{id} test module"),
            },
            version: version.into(),
            host_version: "^0.1.0".into(),
            sdk_version: 2,
            entry: "index.js".into(),
            dependencies: RuntimeModuleDependencies {
                required: required
                    .iter()
                    .map(|(id, version)| RuntimeModuleDependency {
                        id: (*id).into(),
                        version: (*version).into(),
                    })
                    .collect(),
                optional: optional
                    .iter()
                    .map(|(id, version)| RuntimeModuleDependency {
                        id: (*id).into(),
                        version: (*version).into(),
                    })
                    .collect(),
            },
            navigation: Vec::new(),
            settings: Vec::new(),
            native_capabilities: Default::default(),
        }
    }

    fn request(modules: Vec<RuntimeModuleManifest>) -> ResolveRequest {
        let desired_enabled = modules.iter().map(|module| module.id.clone()).collect();
        let mut catalog = BTreeMap::<String, Vec<RuntimeModuleManifest>>::new();
        for module in modules {
            catalog.entry(module.id.clone()).or_default().push(module);
        }
        ResolveRequest {
            catalog,
            desired_enabled,
            current_selected: BTreeMap::new(),
            preferred: None,
            max_search_nodes: 10_000,
        }
    }

    #[test]
    fn reports_missing_and_incompatible_required_dependencies() {
        let missing = resolve(&request(vec![module(
            "report-consumer",
            "1.0.0",
            &[("data-provider", "^1.0.0")],
            &[],
        )]));
        assert!(missing.selected_versions.is_empty());
        assert_eq!(
            missing.diagnostics["report-consumer"][0].code,
            RuntimeModuleDiagnosticCode::MissingDependency
        );
        assert_eq!(
            missing.diagnostics["report-consumer"][0]
                .dependency_id
                .as_deref(),
            Some("data-provider")
        );

        let incompatible = resolve(&request(vec![
            module("data-provider", "1.5.0", &[], &[]),
            module(
                "report-consumer",
                "1.0.0",
                &[("data-provider", ">=2.0.0")],
                &[],
            ),
        ]));
        assert_eq!(incompatible.selected_versions["data-provider"], "1.5.0");
        assert!(
            !incompatible
                .selected_versions
                .contains_key("report-consumer")
        );
        let diagnostic = &incompatible.diagnostics["report-consumer"][0];
        assert_eq!(
            diagnostic.code,
            RuntimeModuleDiagnosticCode::IncompatibleDependency
        );
        assert_eq!(diagnostic.available_versions, vec!["1.5.0"]);
    }

    #[test]
    fn unavailable_optional_dependencies_do_not_block_activation() {
        let result = resolve(&request(vec![module(
            "report-consumer",
            "1.0.0",
            &[],
            &[("export-tools", "^2.0.0")],
        )]));
        assert_eq!(result.selected_versions["report-consumer"], "1.0.0");
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn detects_cycles_without_disabling_an_independent_subgraph() {
        let result = resolve(&request(vec![
            module("alpha-module", "1.0.0", &[("beta-module", "^1.0.0")], &[]),
            module("beta-module", "1.0.0", &[("alpha-module", "^1.0.0")], &[]),
            module("independent-module", "1.0.0", &[], &[]),
        ]));
        assert_eq!(result.selected_versions.len(), 1);
        assert_eq!(result.selected_versions["independent-module"], "1.0.0");
        assert_eq!(result.activation_order, vec!["independent-module"]);
        for id in ["alpha-module", "beta-module"] {
            assert_eq!(
                result.diagnostics[id][0].code,
                RuntimeModuleDiagnosticCode::DependencyCycle
            );
            assert_eq!(
                result.diagnostics[id][0].related_modules,
                vec!["alpha-module", "beta-module", "alpha-module"]
            );
        }
    }

    #[test]
    fn generates_a_stable_provider_first_topological_order() {
        let request = request(vec![
            module(
                "charlie-consumer",
                "1.0.0",
                &[("beta-provider", "^1.0.0")],
                &[],
            ),
            module("alpha-provider", "1.0.0", &[], &[]),
            module("delta-independent", "1.0.0", &[], &[]),
            module(
                "beta-provider",
                "1.0.0",
                &[("alpha-provider", "^1.0.0")],
                &[],
            ),
        ]);
        let first = resolve(&request);
        let second = resolve(&request);
        assert_eq!(first, second);
        assert_eq!(
            first.activation_order,
            vec![
                "alpha-provider",
                "beta-provider",
                "charlie-consumer",
                "delta-independent"
            ]
        );
    }

    #[test]
    fn coordinates_versions_when_a_waiting_upgrade_becomes_satisfiable() {
        let mut request = request(vec![
            module("alpha-provider", "1.0.0", &[], &[]),
            module("alpha-provider", "2.0.0", &[], &[]),
            module(
                "beta-consumer",
                "1.0.0",
                &[("alpha-provider", "^1.0.0")],
                &[],
            ),
            module(
                "beta-consumer",
                "2.0.0",
                &[("alpha-provider", "^2.0.0")],
                &[],
            ),
        ]);
        request.current_selected = BTreeMap::from([
            ("alpha-provider".into(), "1.0.0".into()),
            ("beta-consumer".into(), "1.0.0".into()),
        ]);
        request.preferred = Some(("alpha-provider".into(), "2.0.0".into()));

        let result = resolve(&request);
        assert_eq!(result.selected_versions["alpha-provider"], "2.0.0");
        assert_eq!(result.selected_versions["beta-consumer"], "2.0.0");
    }

    #[test]
    fn retains_the_complete_current_plan_when_a_preferred_version_is_unsatisfiable() {
        let mut request = request(vec![
            module("alpha-provider", "1.0.0", &[], &[]),
            module("alpha-provider", "2.0.0", &[], &[]),
            module(
                "beta-consumer",
                "1.0.0",
                &[("alpha-provider", "^1.0.0")],
                &[],
            ),
        ]);
        request.current_selected = BTreeMap::from([
            ("alpha-provider".into(), "1.0.0".into()),
            ("beta-consumer".into(), "1.0.0".into()),
        ]);
        request.preferred = Some(("alpha-provider".into(), "2.0.0".into()));

        let result = resolve(&request);
        assert_eq!(result.selected_versions, request.current_selected);
    }

    #[test]
    fn stops_at_a_deterministic_search_limit_and_keeps_a_valid_current_plan() {
        let mut modules = Vec::new();
        for id in ["alpha-module", "beta-module", "charlie-module"] {
            for version in ["1.0.0", "2.0.0", "3.0.0"] {
                modules.push(module(id, version, &[], &[]));
            }
        }
        let mut request = request(modules);
        request.current_selected = BTreeMap::from([
            ("alpha-module".into(), "1.0.0".into()),
            ("beta-module".into(), "1.0.0".into()),
            ("charlie-module".into(), "1.0.0".into()),
        ]);
        request.max_search_nodes = 1;

        let first = resolve(&request);
        let second = resolve(&request);
        assert_eq!(first, second);
        assert!(first.limit_reached);
        assert_eq!(first.selected_versions, request.current_selected);
        assert!(
            first
                .diagnostics
                .values()
                .flatten()
                .any(|diagnostic| diagnostic.code == RuntimeModuleDiagnosticCode::ResolutionLimit)
        );
    }

    #[test]
    fn desired_set_can_exclude_an_installed_module() {
        let mut request = request(vec![
            module("alpha-module", "1.0.0", &[], &[]),
            module("beta-module", "1.0.0", &[], &[]),
        ]);
        request.desired_enabled = BTreeSet::from(["alpha-module".into()]);
        let result = resolve(&request);
        assert_eq!(
            result.selected_versions.keys().cloned().collect::<Vec<_>>(),
            vec!["alpha-module"]
        );
    }
}
