use std::{collections::BTreeMap, path::PathBuf, sync::Mutex, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState as SystemShortcutState};

use super::{
    filesystem::{
        DirectoryEntry, FileGrant, FileGrantSummary, FilesystemManager, GrantAccess, GrantKind,
    },
    permissions::{
        ExternalFileAccess, NativeCapabilityKind, PermissionDecision, PermissionStore,
        RegistryHive, TrayItemKind,
    },
    process::{
        ProcessResult, ProcessSupervisor, SystemPathOpener, SystemUrlOpener, open_approved_url,
        open_granted_file, reveal_granted_file,
    },
    registry::{RegistryProxy, RegistryValue},
    session::{NativeSession, SessionManager},
    shortcuts::{ShortcutRegistry, ShortcutState, ShortcutStatus},
    tray::{TrayItemUpdate, TrayRegistry},
};
use crate::features::runtime_modules::module_store;

pub struct NativeRuntimeState {
    app: AppHandle,
    sessions: SessionManager,
    filesystem: FilesystemManager,
    processes: ProcessSupervisor,
    tray: TrayRegistry,
    shortcuts: ShortcutRegistry,
    registered_shortcuts: Mutex<BTreeMap<String, String>>,
    locale: Mutex<String>,
}

impl NativeRuntimeState {
    pub fn new(app: AppHandle, app_data: PathBuf) -> Self {
        let filesystem = FilesystemManager::new(
            app_data.join("runtime-module-data"),
            app_data.join("native-file-grants.json"),
        );
        let processes = ProcessSupervisor::new(&filesystem);
        Self {
            app,
            sessions: SessionManager::default(),
            filesystem,
            processes,
            tray: TrayRegistry::default(),
            shortcuts: ShortcutRegistry::new(app_data.join("native-shortcuts.json")),
            registered_shortcuts: Mutex::new(BTreeMap::new()),
            locale: Mutex::new("zh-CN".into()),
        }
    }

    pub fn set_locale(&self, locale: &str) -> Result<(), String> {
        if !matches!(locale, "zh-CN" | "en") {
            return Err(format!("unsupported application locale: {locale}"));
        }
        *self
            .locale
            .lock()
            .map_err(|_| "application locale lock poisoned")? = locale.to_owned();
        self.sync_tray()
    }

    fn session(
        &self,
        token: &str,
        capability: NativeCapabilityKind,
    ) -> Result<NativeSession, String> {
        self.sessions.require(token, capability)
    }

    pub fn release(&self, token: &str) -> Result<(), String> {
        let session = self.sessions.get(token)?;
        self.processes.cancel_session(token);
        self.tray.deactivate_module(&session.module_id);
        self.deactivate_shortcuts(&session.module_id);
        self.sessions.revoke_token(token);
        self.sync_tray()?;
        Ok(())
    }

    pub fn release_module(&self, module_id: &str) {
        for token in self.sessions.revoke_module(module_id) {
            self.processes.cancel_session(&token);
        }
        self.tray.deactivate_module(module_id);
        self.deactivate_shortcuts(module_id);
        let _ = self.sync_tray();
    }

    pub fn list_admin_grants(&self, module_id: &str) -> Result<Vec<FileGrant>, String> {
        self.filesystem.list_grants(module_id)
    }

    pub fn create_admin_grant(
        &self,
        module_id: &str,
        path: &std::path::Path,
        kind: GrantKind,
        access: GrantAccess,
    ) -> Result<FileGrant, String> {
        self.filesystem.create_grant(module_id, path, kind, access)
    }

    pub fn revoke_admin_grant(&self, module_id: &str, grant_id: &str) -> Result<(), String> {
        self.filesystem.revoke_grant(module_id, grant_id)
    }

    pub fn shortcut_statuses(&self, module_id: &str) -> Result<Vec<ShortcutStatus>, String> {
        self.shortcuts.statuses(module_id)
    }

    pub fn rebind_admin_shortcut(
        &self,
        module_id: &str,
        shortcut_id: &str,
        accelerator: &str,
    ) -> Result<Vec<ShortcutStatus>, String> {
        self.shortcuts.rebind(module_id, shortcut_id, accelerator)?;
        self.unregister_system_shortcut(module_id, shortcut_id);
        self.register_system_shortcut(module_id, shortcut_id, accelerator)?;
        self.shortcuts.statuses(module_id)
    }

    pub fn disable_admin_shortcut(
        &self,
        module_id: &str,
        shortcut_id: &str,
    ) -> Result<Vec<ShortcutStatus>, String> {
        self.shortcuts.disable(module_id, shortcut_id)?;
        self.unregister_system_shortcut(module_id, shortcut_id);
        self.shortcuts.statuses(module_id)
    }

    fn activate_shortcuts(
        &self,
        module_id: &str,
        session_token: &str,
        declarations: Vec<super::permissions::ShortcutDeclaration>,
    ) -> Result<(), String> {
        let statuses = self
            .shortcuts
            .activate_module(module_id, session_token, declarations)?;
        for status in statuses {
            if status.state == ShortcutState::Registered
                && let Some(accelerator) = status.accelerator
            {
                self.register_system_shortcut(module_id, &status.shortcut_id, &accelerator)?;
            }
        }
        Ok(())
    }

    fn register_system_shortcut(
        &self,
        module_id: &str,
        shortcut_id: &str,
        accelerator: &str,
    ) -> Result<(), String> {
        let event_module_id = module_id.to_owned();
        let event_item_id = shortcut_id.to_owned();
        let registration =
            self.app
                .global_shortcut()
                .on_shortcut(accelerator, move |app, _, event| {
                    if event.state == SystemShortcutState::Pressed {
                        let _ = app.emit(
                            "runtime-module-shortcut",
                            NativeContributionEvent {
                                module_id: event_module_id.clone(),
                                item_id: event_item_id.clone(),
                            },
                        );
                    }
                });
        if registration.is_err() {
            self.shortcuts.mark_conflict(module_id, shortcut_id)?;
            return Ok(());
        }
        self.registered_shortcuts
            .lock()
            .map_err(|_| "registered shortcut lock poisoned")?
            .insert(
                format!("{module_id}::{shortcut_id}"),
                accelerator.to_owned(),
            );
        Ok(())
    }

    fn unregister_system_shortcut(&self, module_id: &str, shortcut_id: &str) {
        let accelerator = self
            .registered_shortcuts
            .lock()
            .ok()
            .and_then(|mut shortcuts| shortcuts.remove(&format!("{module_id}::{shortcut_id}")));
        if let Some(accelerator) = accelerator {
            let _ = self.app.global_shortcut().unregister(accelerator.as_str());
        }
    }

    fn deactivate_shortcuts(&self, module_id: &str) {
        let removed = self
            .registered_shortcuts
            .lock()
            .ok()
            .map(|mut shortcuts| {
                let prefix = format!("{module_id}::");
                let keys = shortcuts
                    .keys()
                    .filter(|key| key.starts_with(&prefix))
                    .cloned()
                    .collect::<Vec<_>>();
                keys.into_iter()
                    .filter_map(|key| shortcuts.remove(&key))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for accelerator in removed {
            let _ = self.app.global_shortcut().unregister(accelerator.as_str());
        }
        self.shortcuts.deactivate_module(module_id);
    }

    fn sync_tray(&self) -> Result<(), String> {
        const TRAY_ID: &str = "runtime-modules";
        let locale = self
            .locale
            .lock()
            .map_err(|_| "application locale lock poisoned")?
            .clone();
        self.tray.set_locale(&locale)?;
        let groups = self.tray.snapshot();
        if groups.is_empty() {
            self.app.remove_tray_by_id(TRAY_ID);
            return Ok(());
        }

        let menu = Menu::new(&self.app).map_err(|error| format!("create tray menu: {error}"))?;
        let show_label = if locale == "en" { "Show main window" } else { "显示主窗口" };
        let show = MenuItem::with_id(&self.app, "host::show", show_label, true, None::<&str>)
            .map_err(|error| format!("create tray show item: {error}"))?;
        menu.append(&show)
            .map_err(|error| format!("append tray show item: {error}"))?;
        for group in groups {
            let submenu = Submenu::with_id(
                &self.app,
                format!("module::{}", group.module_id),
                &group.module_id,
                true,
            )
            .map_err(|error| format!("create module tray group: {error}"))?;
            for item in group.items {
                let namespaced = format!("{}::{}", group.module_id, item.id);
                match item.kind {
                    TrayItemKind::Button => {
                        let menu_item = MenuItem::with_id(
                            &self.app,
                            namespaced,
                            item.label,
                            item.enabled,
                            None::<&str>,
                        )
                        .map_err(|error| format!("create module tray item: {error}"))?;
                        submenu
                            .append(&menu_item)
                            .map_err(|error| format!("append module tray item: {error}"))?;
                    }
                    TrayItemKind::Check => {
                        let menu_item = CheckMenuItem::with_id(
                            &self.app,
                            namespaced,
                            item.label,
                            item.enabled,
                            item.checked,
                            None::<&str>,
                        )
                        .map_err(|error| format!("create module tray check item: {error}"))?;
                        submenu
                            .append(&menu_item)
                            .map_err(|error| format!("append module tray check item: {error}"))?;
                    }
                    TrayItemKind::Separator => {
                        let separator = PredefinedMenuItem::separator(&self.app)
                            .map_err(|error| format!("create module tray separator: {error}"))?;
                        submenu
                            .append(&separator)
                            .map_err(|error| format!("append module tray separator: {error}"))?;
                    }
                }
            }
            menu.append(&submenu)
                .map_err(|error| format!("append module tray group: {error}"))?;
        }
        let quit_label = if locale == "en" { "Quit" } else { "退出" };
        let quit = MenuItem::with_id(&self.app, "host::quit", quit_label, true, None::<&str>)
            .map_err(|error| format!("create tray quit item: {error}"))?;
        menu.append(&quit)
            .map_err(|error| format!("append tray quit item: {error}"))?;

        if let Some(tray) = self.app.tray_by_id(TRAY_ID) {
            tray.set_menu(Some(menu))
                .map_err(|error| format!("update tray menu: {error}"))?;
        } else {
            let mut builder = TrayIconBuilder::with_id(TRAY_ID)
                .menu(&menu)
                .tooltip("Modular Tauri Template");
            if let Some(icon) = self.app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            builder
                .on_menu_event(|app, event| handle_tray_menu_event(app, event.id().as_ref()))
                .build(&self.app)
                .map_err(|error| format!("create application tray: {error}"))?;
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeContributionEvent {
    module_id: String,
    item_id: String,
}

#[tauri::command]
pub fn set_application_locale(
    locale: String,
    state: State<'_, NativeRuntimeState>,
) -> Result<(), String> {
    state.set_locale(&locale)
}

fn handle_tray_menu_event(app: &AppHandle, id: &str) {
    if id == "host::show" {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }
    if id == "host::quit" {
        app.exit(0);
        return;
    }
    let state = app.state::<NativeRuntimeState>();
    if let Ok(event) = state.tray.route_click(id) {
        let _ = app.emit(
            "runtime-module-tray",
            NativeContributionEvent {
                module_id: event.module_id,
                item_id: event.item_id,
            },
        );
    }
}

fn active_v3_module(
    app: &AppHandle,
    module_id: &str,
) -> Result<crate::features::runtime_modules::store::InstalledRuntimeModule, String> {
    let snapshot = module_store(app)?.snapshot(&[])?;
    let module = snapshot
        .modules
        .into_iter()
        .find(|module| module.manifest.id == module_id)
        .ok_or_else(|| format!("runtime module is not installed: {module_id}"))?;
    if module.manifest.sdk_version != 3
        || module.status != crate::features::runtime_modules::types::RuntimeModuleStatus::Active
    {
        return Err(format!(
            "runtime module is not an active Host SDK V3 module: {module_id}"
        ));
    }
    Ok(module)
}

#[tauri::command]
pub fn list_runtime_module_native_file_grants(
    app: AppHandle,
    state: State<'_, NativeRuntimeState>,
    module_id: String,
) -> Result<Vec<FileGrantSummary>, String> {
    active_v3_module(&app, &module_id)?;
    state
        .list_admin_grants(&module_id)
        .map(|grants| grants.into_iter().map(FileGrantSummary::from).collect())
}

#[tauri::command]
pub fn create_runtime_module_file_grant(
    app: AppHandle,
    state: State<'_, NativeRuntimeState>,
    module_id: String,
    path: String,
    kind: GrantKind,
    access: GrantAccess,
) -> Result<FileGrantSummary, String> {
    let module = active_v3_module(&app, &module_id)?;
    let permissions = module.manifest.normalized_native_capabilities()?;
    let allowed = match kind {
        GrantKind::Executable => permissions
            .process
            .is_some_and(|process| process.executable_grants && access.execute),
        GrantKind::File | GrantKind::Directory => {
            permissions.filesystem.is_some_and(|filesystem| {
                !access.execute
                    && (!access.read || filesystem.external.contains(&ExternalFileAccess::Read))
                    && (!access.write || filesystem.external.contains(&ExternalFileAccess::Write))
                    && (!access.list || filesystem.external.contains(&ExternalFileAccess::List))
            })
        }
    };
    if !allowed {
        return Err("permission_denied".into());
    }
    state
        .create_admin_grant(&module_id, std::path::Path::new(&path), kind, access)
        .map(FileGrantSummary::from)
}

#[tauri::command]
pub fn revoke_runtime_module_admin_file_grant(
    app: AppHandle,
    state: State<'_, NativeRuntimeState>,
    module_id: String,
    grant_id: String,
) -> Result<(), String> {
    active_v3_module(&app, &module_id)?;
    state.revoke_admin_grant(&module_id, &grant_id)
}

#[tauri::command]
pub fn list_runtime_module_shortcut_statuses(
    app: AppHandle,
    state: State<'_, NativeRuntimeState>,
    module_id: String,
) -> Result<Vec<ShortcutStatus>, String> {
    active_v3_module(&app, &module_id)?;
    state.shortcut_statuses(&module_id)
}

#[tauri::command]
pub fn rebind_runtime_module_shortcut(
    app: AppHandle,
    state: State<'_, NativeRuntimeState>,
    module_id: String,
    shortcut_id: String,
    accelerator: String,
) -> Result<Vec<ShortcutStatus>, String> {
    active_v3_module(&app, &module_id)?;
    state.rebind_admin_shortcut(&module_id, &shortcut_id, &accelerator)
}

#[tauri::command]
pub fn disable_runtime_module_shortcut(
    app: AppHandle,
    state: State<'_, NativeRuntimeState>,
    module_id: String,
    shortcut_id: String,
) -> Result<Vec<ShortcutStatus>, String> {
    active_v3_module(&app, &module_id)?;
    state.disable_admin_shortcut(&module_id, &shortcut_id)
}

#[tauri::command]
pub fn create_runtime_module_native_session(
    app: AppHandle,
    state: State<'_, NativeRuntimeState>,
    module_id: String,
    version: String,
) -> Result<String, String> {
    let snapshot = module_store(&app)?.snapshot(&[])?;
    let module = snapshot
        .modules
        .iter()
        .find(|module| module.manifest.id == module_id)
        .ok_or_else(|| format!("runtime module is not installed: {module_id}"))?;
    let selected = module.selected_version.as_deref() == Some(version.as_str())
        && module.status == crate::features::runtime_modules::types::RuntimeModuleStatus::Active;
    if module.manifest.sdk_version != 3 {
        return Err("native sessions require Host SDK V3".into());
    }
    let permissions = module.manifest.normalized_native_capabilities()?;
    let permission_path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve application data directory: {error}"))?
        .join("native-permissions.json");
    let approved = PermissionStore::new(permission_path).decision(&module_id, &permissions)?
        == PermissionDecision::Approved;
    state.release_module(&module_id);
    let token = state.sessions.issue(
        &module_id,
        &version,
        permissions.clone(),
        selected,
        approved,
    )?;
    if let Err(error) = state
        .tray
        .activate_module(&module_id, &token, permissions.tray.clone())
        .and_then(|_| state.activate_shortcuts(&module_id, &token, permissions.shortcuts.clone()))
    {
        state.release_module(&module_id);
        return Err(error);
    }
    state.sync_tray()?;
    Ok(token)
}

#[tauri::command]
pub fn release_runtime_module_native_session(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
) -> Result<(), String> {
    state.release(&session_token)
}

#[tauri::command]
pub fn read_runtime_module_private_file(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    path: String,
) -> Result<Vec<u8>, String> {
    let session = state.session(&session_token, NativeCapabilityKind::Filesystem)?;
    state.filesystem.read_private(&session.module_id, &path)
}

#[tauri::command]
pub fn write_runtime_module_private_file(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    path: String,
    data: Vec<u8>,
) -> Result<usize, String> {
    let session = state.session(&session_token, NativeCapabilityKind::Filesystem)?;
    state
        .filesystem
        .write_private(&session.module_id, &path, &data)
}

#[tauri::command]
pub fn list_runtime_module_file_grants(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
) -> Result<Vec<FileGrantSummary>, String> {
    let session = state.session(&session_token, NativeCapabilityKind::Filesystem)?;
    state
        .filesystem
        .list_grants(&session.module_id)
        .map(|grants| grants.into_iter().map(FileGrantSummary::from).collect())
}

#[tauri::command]
pub fn read_runtime_module_granted_file(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    grant_id: String,
) -> Result<Vec<u8>, String> {
    let session = state.session(&session_token, NativeCapabilityKind::Filesystem)?;
    state.filesystem.read_grant(&session.module_id, &grant_id)
}

#[tauri::command]
pub fn write_runtime_module_granted_file(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    grant_id: String,
    data: Vec<u8>,
) -> Result<usize, String> {
    let session = state.session(&session_token, NativeCapabilityKind::Filesystem)?;
    state
        .filesystem
        .write_grant(&session.module_id, &grant_id, &data)
}

#[tauri::command]
pub fn list_runtime_module_granted_directory(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    grant_id: String,
) -> Result<Vec<DirectoryEntry>, String> {
    let session = state.session(&session_token, NativeCapabilityKind::Filesystem)?;
    state
        .filesystem
        .list_grant_directory(&session.module_id, &grant_id)
}

#[tauri::command]
pub fn revoke_runtime_module_file_grant(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    grant_id: String,
) -> Result<(), String> {
    let session = state.session(&session_token, NativeCapabilityKind::Filesystem)?;
    state.filesystem.revoke_grant(&session.module_id, &grant_id)
}

#[tauri::command]
pub fn open_runtime_module_url(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    url: String,
) -> Result<(), String> {
    let session = state.session(&session_token, NativeCapabilityKind::Process)?;
    let allowed = session
        .permissions
        .process
        .ok_or("permission_denied")?
        .url_schemes;
    open_approved_url(&SystemUrlOpener, &url, &allowed)
}

#[tauri::command]
pub fn open_runtime_module_granted_file(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    grant_id: String,
) -> Result<(), String> {
    let session = state.session(&session_token, NativeCapabilityKind::Filesystem)?;
    open_granted_file(
        &SystemPathOpener,
        &state.filesystem,
        &session.module_id,
        &grant_id,
    )
}

#[tauri::command]
pub fn reveal_runtime_module_granted_file(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    grant_id: String,
) -> Result<(), String> {
    let session = state.session(&session_token, NativeCapabilityKind::Filesystem)?;
    reveal_granted_file(
        &SystemPathOpener,
        &state.filesystem,
        &session.module_id,
        &grant_id,
    )
}

#[tauri::command]
pub fn run_runtime_module_process(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    grant_id: String,
    arguments: Vec<String>,
    timeout_ms: Option<u64>,
) -> Result<ProcessResult, String> {
    let session = state.session(&session_token, NativeCapabilityKind::Process)?;
    if !session
        .permissions
        .process
        .as_ref()
        .is_some_and(|process| process.executable_grants)
    {
        return Err("permission_denied".into());
    }
    state.processes.run(
        &session_token,
        &session.module_id,
        &grant_id,
        &arguments,
        Duration::from_millis(timeout_ms.unwrap_or(30_000)),
    )
}

fn registry_session(
    state: &NativeRuntimeState,
    token: &str,
) -> Result<(NativeSession, RegistryProxy), String> {
    let session = state.session(token, NativeCapabilityKind::Registry)?;
    let proxy = RegistryProxy::new(session.permissions.registry.clone());
    Ok((session, proxy))
}

#[tauri::command]
pub fn read_runtime_module_registry(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    hive: RegistryHive,
    key: String,
    name: String,
) -> Result<RegistryValue, String> {
    let (_, proxy) = registry_session(&state, &session_token)?;
    proxy.read(hive, &key, &name)
}

#[tauri::command]
pub fn write_runtime_module_registry(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    hive: RegistryHive,
    key: String,
    name: String,
    value: RegistryValue,
) -> Result<(), String> {
    let (_, proxy) = registry_session(&state, &session_token)?;
    proxy.write(hive, &key, &name, value)
}

#[tauri::command]
pub fn delete_runtime_module_registry_value(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    hive: RegistryHive,
    key: String,
    name: String,
) -> Result<(), String> {
    let (_, proxy) = registry_session(&state, &session_token)?;
    proxy.delete_value(hive, &key, &name)
}

#[tauri::command]
pub fn update_runtime_module_tray_item(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    item_id: String,
    update: TrayItemUpdate,
) -> Result<(), String> {
    state.session(&session_token, NativeCapabilityKind::Tray)?;
    state.tray.update(&session_token, &item_id, update)?;
    state.sync_tray()
}

#[tauri::command]
pub fn list_runtime_module_shortcuts(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
) -> Result<Vec<ShortcutStatus>, String> {
    let session = state.session(&session_token, NativeCapabilityKind::Shortcuts)?;
    state.shortcuts.statuses(&session.module_id)
}

#[tauri::command]
pub fn rebind_runtime_module_session_shortcut(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    shortcut_id: String,
    accelerator: String,
) -> Result<Vec<ShortcutStatus>, String> {
    let session = state.session(&session_token, NativeCapabilityKind::Shortcuts)?;
    state.rebind_admin_shortcut(&session.module_id, &shortcut_id, &accelerator)
}

#[tauri::command]
pub fn disable_runtime_module_session_shortcut(
    state: State<'_, NativeRuntimeState>,
    session_token: String,
    shortcut_id: String,
) -> Result<Vec<ShortcutStatus>, String> {
    let session = state.session(&session_token, NativeCapabilityKind::Shortcuts)?;
    state.disable_admin_shortcut(&session.module_id, &shortcut_id)
}
