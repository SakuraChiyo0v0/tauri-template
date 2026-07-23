import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RuntimeModuleNativeBackend } from "./runtime-module-types";

function requireTauri() {
  if (!isTauri()) throw new Error("运行时模块原生能力只能在 Tauri 桌面应用中执行。");
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  requireTauri();
  return invoke<T>(command, args);
}

export const runtimeModuleNativeApi: RuntimeModuleNativeBackend = {
  createSession: (moduleId, version) => call("create_runtime_module_native_session", { moduleId, version }),
  releaseSession: (sessionToken) => call("release_runtime_module_native_session", { sessionToken }),
  readPrivateFile: (sessionToken, path) => call("read_runtime_module_private_file", { sessionToken, path }),
  writePrivateFile: (sessionToken, path, data) => call("write_runtime_module_private_file", { sessionToken, path, data }),
  listFileGrants: (sessionToken) => call("list_runtime_module_file_grants", { sessionToken }),
  readGrantedFile: (sessionToken, grantId) => call("read_runtime_module_granted_file", { sessionToken, grantId }),
  writeGrantedFile: (sessionToken, grantId, data) => call("write_runtime_module_granted_file", { sessionToken, grantId, data }),
  listGrantedDirectory: (sessionToken, grantId) => call("list_runtime_module_granted_directory", { sessionToken, grantId }),
  revokeFileGrant: (sessionToken, grantId) => call("revoke_runtime_module_file_grant", { sessionToken, grantId }),
  openUrl: (sessionToken, url) => call("open_runtime_module_url", { sessionToken, url }),
  openPath: (sessionToken, grantId) => call("open_runtime_module_granted_file", { sessionToken, grantId }),
  revealInFolder: (sessionToken, grantId) => call("reveal_runtime_module_granted_file", { sessionToken, grantId }),
  runProcess: (sessionToken, grantId, arguments_, timeoutMs) => call("run_runtime_module_process", { sessionToken, grantId, arguments: arguments_, timeoutMs }),
  readRegistry: (sessionToken, hive, key, name) => call("read_runtime_module_registry", { sessionToken, hive, key, name }),
  writeRegistry: (sessionToken, _hive, key, name, value) => call("write_runtime_module_registry", { sessionToken, hive: "HKCU", key, name, value }),
  deleteRegistryValue: (sessionToken, _hive, key, name) => call("delete_runtime_module_registry_value", { sessionToken, hive: "HKCU", key, name }),
  updateTrayItem: (sessionToken, itemId, update) => call("update_runtime_module_tray_item", { sessionToken, itemId, update }),
  listShortcuts: (sessionToken) => call("list_runtime_module_shortcuts", { sessionToken }),
  rebindShortcut: (sessionToken, shortcutId, accelerator) => call("rebind_runtime_module_session_shortcut", { sessionToken, shortcutId, accelerator }),
  disableShortcut: (sessionToken, shortcutId) => call("disable_runtime_module_session_shortcut", { sessionToken, shortcutId }),
  createModuleRepositoryGrant: (sessionToken, path) => call("create_runtime_module_repository_grant", { sessionToken, path }),
  scanModuleRepository: (sessionToken, grantId) => call("scan_runtime_module_repository", { sessionToken, grantId }),
  installModuleFromRepository: (sessionToken, grantId, fileName) => call("install_runtime_module_from_repository", { sessionToken, grantId, fileName }),
  onTrayAction: (moduleId, listener) => listen<{ moduleId: string; itemId: string }>("runtime-module-tray", (event) => {
    if (event.payload.moduleId === moduleId) listener(event.payload.itemId);
  }),
  onShortcutTrigger: (moduleId, listener) => listen<{ moduleId: string; itemId: string }>("runtime-module-shortcut", (event) => {
    if (event.payload.moduleId === moduleId) listener(event.payload.itemId);
  }),
};
