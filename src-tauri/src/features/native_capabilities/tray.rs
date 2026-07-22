use std::{collections::BTreeMap, sync::Mutex};

use serde::{Deserialize, Serialize};

use super::permissions::{NativeCapabilities, TrayItemDeclaration, TrayItemKind};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrayItemUpdate {
    pub label: Option<String>,
    pub enabled: Option<bool>,
    pub checked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrayItemState {
    pub id: String,
    pub label: String,
    pub kind: TrayItemKind,
    pub order: i32,
    pub enabled: bool,
    pub checked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrayGroup {
    pub module_id: String,
    pub items: Vec<TrayItemState>,
    #[serde(skip)]
    session_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrayEvent {
    pub module_id: String,
    pub item_id: String,
    pub session_token: String,
}

#[derive(Debug, Default)]
pub struct TrayRegistry {
    modules: Mutex<BTreeMap<String, TrayGroup>>,
}

impl TrayRegistry {
    pub fn activate_module(
        &self,
        module_id: &str,
        session_token: &str,
        items: Vec<TrayItemDeclaration>,
    ) -> Result<(), String> {
        let normalized = NativeCapabilities {
            tray: items,
            ..NativeCapabilities::default()
        }
        .normalize()?
        .tray;
        if session_token.is_empty() {
            return Err("tray session token must not be empty".into());
        }

        let mut modules = self
            .modules
            .lock()
            .map_err(|_| "tray registry lock poisoned")?;
        if modules.contains_key(module_id) {
            return Err(format!("tray module is already active: {module_id}"));
        }
        let items = normalized
            .into_iter()
            .map(|item| TrayItemState {
                id: item.id,
                label: item.label,
                kind: item.kind,
                order: item.order,
                enabled: true,
                checked: false,
            })
            .collect();
        modules.insert(
            module_id.to_owned(),
            TrayGroup {
                module_id: module_id.to_owned(),
                items,
                session_token: session_token.to_owned(),
            },
        );
        Ok(())
    }

    pub fn snapshot(&self) -> Vec<TrayGroup> {
        self.modules
            .lock()
            .map(|modules| modules.values().cloned().collect())
            .unwrap_or_default()
    }

    pub fn route_click(&self, namespaced_id: &str) -> Result<TrayEvent, String> {
        let (module_id, item_id) = namespaced_id
            .split_once("::")
            .ok_or_else(|| "tray item id must be namespaced".to_owned())?;
        let modules = self
            .modules
            .lock()
            .map_err(|_| "tray registry lock poisoned")?;
        let group = modules
            .get(module_id)
            .ok_or_else(|| format!("tray module is not active: {module_id}"))?;
        let item = group
            .items
            .iter()
            .find(|item| item.id == item_id)
            .ok_or_else(|| format!("tray item is not active: {namespaced_id}"))?;
        if !item.enabled || item.kind == TrayItemKind::Separator {
            return Err(format!("tray item cannot be activated: {namespaced_id}"));
        }
        Ok(TrayEvent {
            module_id: module_id.to_owned(),
            item_id: item_id.to_owned(),
            session_token: group.session_token.clone(),
        })
    }

    pub fn update(
        &self,
        session_token: &str,
        item_id: &str,
        update: TrayItemUpdate,
    ) -> Result<(), String> {
        let mut modules = self
            .modules
            .lock()
            .map_err(|_| "tray registry lock poisoned")?;
        let group = modules
            .values_mut()
            .find(|group| group.session_token == session_token)
            .ok_or_else(|| "tray session is not active".to_owned())?;
        let item = group
            .items
            .iter_mut()
            .find(|item| item.id == item_id)
            .ok_or_else(|| format!("tray item is not owned by this session: {item_id}"))?;

        if let Some(label) = update.label {
            if item.kind == TrayItemKind::Separator
                || label.trim().is_empty()
                || label.len() > 120
                || label.chars().any(char::is_control)
            {
                return Err("invalid tray item label".into());
            }
            item.label = label;
        }
        if let Some(enabled) = update.enabled {
            item.enabled = enabled;
        }
        if let Some(checked) = update.checked {
            if item.kind != TrayItemKind::Check {
                return Err("only check tray items have a checked state".into());
            }
            item.checked = checked;
        }
        Ok(())
    }

    pub fn deactivate_module(&self, module_id: &str) {
        if let Ok(mut modules) = self.modules.lock() {
            modules.remove(module_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::native_capabilities::permissions::{TrayItemDeclaration, TrayItemKind};

    fn items() -> Vec<TrayItemDeclaration> {
        vec![
            TrayItemDeclaration {
                id: "open-main".into(),
                label: "Open".into(),
                kind: TrayItemKind::Button,
                order: 10,
            },
            TrayItemDeclaration {
                id: "watch-mode".into(),
                label: "Watch".into(),
                kind: TrayItemKind::Check,
                order: 20,
            },
        ]
    }

    #[test]
    fn groups_modules_routes_only_owner_events_and_updates_declared_items() {
        let registry = TrayRegistry::default();
        registry
            .activate_module("alpha-module", "alpha-token", items())
            .unwrap();
        registry
            .activate_module(
                "beta-module",
                "beta-token",
                vec![TrayItemDeclaration {
                    id: "open-main".into(),
                    label: "Beta".into(),
                    kind: TrayItemKind::Button,
                    order: 5,
                }],
            )
            .unwrap();
        let snapshot = registry.snapshot();
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].module_id, "alpha-module");
        assert_eq!(
            registry
                .route_click("alpha-module::open-main")
                .unwrap()
                .session_token,
            "alpha-token"
        );

        registry
            .update(
                "alpha-token",
                "watch-mode",
                TrayItemUpdate {
                    label: Some("Watching".into()),
                    enabled: Some(false),
                    checked: Some(true),
                },
            )
            .unwrap();
        let alpha = registry
            .snapshot()
            .into_iter()
            .find(|group| group.module_id == "alpha-module")
            .unwrap();
        assert_eq!(alpha.items[1].label, "Watching");
        assert!(!alpha.items[1].enabled);
        assert!(alpha.items[1].checked);
        assert!(
            registry
                .update("beta-token", "watch-mode", TrayItemUpdate::default())
                .is_err()
        );
    }

    #[test]
    fn rejects_duplicate_items_and_cleans_only_deactivated_module() {
        let registry = TrayRegistry::default();
        let duplicate = vec![items()[0].clone(), items()[0].clone()];
        assert!(
            registry
                .activate_module("alpha-module", "alpha-token", duplicate)
                .is_err()
        );
        registry
            .activate_module("alpha-module", "alpha-token", items())
            .unwrap();
        registry
            .activate_module("beta-module", "beta-token", items())
            .unwrap();
        registry.deactivate_module("alpha-module");
        assert!(registry.route_click("alpha-module::open-main").is_err());
        assert_eq!(
            registry
                .route_click("beta-module::open-main")
                .unwrap()
                .module_id,
            "beta-module"
        );
    }

    #[test]
    fn separators_allow_empty_labels_but_cannot_be_activated() {
        let registry = TrayRegistry::default();
        registry
            .activate_module(
                "alpha-module",
                "alpha-token",
                vec![TrayItemDeclaration {
                    id: "divider".into(),
                    label: String::new(),
                    kind: TrayItemKind::Separator,
                    order: 0,
                }],
            )
            .unwrap();
        assert!(registry.route_click("alpha-module::divider").is_err());
    }
}
