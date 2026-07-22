import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  RuntimeModuleEntry,
  ModuleDataInventoryItem,
  RuntimeModuleOperationResult,
  RuntimeModulePlanSnapshot,
} from "./runtime-module-types";

function requireTauri() {
  if (!isTauri()) throw new Error("运行时模块操作只能在 Tauri 桌面应用中执行。");
}

export const runtimeModuleApi = {
  async list(legacyDisabledModuleIds: string[] = []): Promise<RuntimeModulePlanSnapshot> {
    if (!isTauri()) {
      return {
        plan: {
          generation: 0,
          desiredEnabled: {},
          selectedVersions: {},
          previousSelectedVersions: {},
          activationOrder: [],
          diagnostics: {},
        },
        modules: [],
      };
    }
    return invoke("list_runtime_modules", { legacyDisabledModuleIds });
  },

  async install(packagePath: string): Promise<RuntimeModuleOperationResult> {
    requireTauri();
    return invoke("install_runtime_module", { packagePath });
  },

  async readEntry(moduleId: string): Promise<RuntimeModuleEntry> {
    requireTauri();
    return invoke("read_runtime_module_entry", { moduleId });
  },

  async rollback(moduleId: string): Promise<RuntimeModuleOperationResult> {
    requireTauri();
    return invoke("rollback_runtime_module", { moduleId });
  },

  async reportActivationFailure(
    moduleId: string,
    failedVersion: string,
    message: string,
  ): Promise<RuntimeModuleOperationResult> {
    requireTauri();
    return invoke("report_runtime_module_activation_failure", { moduleId, failedVersion, message });
  },

  async setEnabled(moduleId: string, enabled: boolean): Promise<RuntimeModuleOperationResult> {
    requireTauri();
    return invoke("set_runtime_module_enabled", { moduleId, enabled });
  },

  async uninstall(moduleId: string): Promise<RuntimeModuleOperationResult> {
    requireTauri();
    return invoke("uninstall_runtime_module", { moduleId });
  },

  async listData(): Promise<ModuleDataInventoryItem[]> {
    if (!isTauri()) return [];
    return invoke("list_runtime_module_data");
  },

  async clearData(moduleId: string): Promise<ModuleDataInventoryItem[]> {
    requireTauri();
    return invoke("clear_runtime_module_data", { moduleId });
  },
};

export type RuntimeModuleApi = typeof runtimeModuleApi;
