import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ActivationFailureResult,
  InstalledRuntimeModule,
  RuntimeModuleEntry,
} from "./runtime-module-types";

function requireTauri() {
  if (!isTauri()) throw new Error("运行时模块操作只能在 Tauri 桌面应用中执行。");
}

export const runtimeModuleApi = {
  async list(): Promise<InstalledRuntimeModule[]> {
    if (!isTauri()) return [];
    return invoke("list_runtime_modules");
  },

  async install(packagePath: string): Promise<InstalledRuntimeModule> {
    requireTauri();
    return invoke("install_runtime_module", { packagePath });
  },

  async readEntry(moduleId: string): Promise<RuntimeModuleEntry> {
    requireTauri();
    return invoke("read_runtime_module_entry", { moduleId });
  },

  async rollback(moduleId: string): Promise<InstalledRuntimeModule> {
    requireTauri();
    return invoke("rollback_runtime_module", { moduleId });
  },

  async reportActivationFailure(
    moduleId: string,
    failedVersion: string,
    message: string,
  ): Promise<ActivationFailureResult> {
    requireTauri();
    return invoke("report_runtime_module_activation_failure", { moduleId, failedVersion, message });
  },

  async uninstall(moduleId: string): Promise<void> {
    requireTauri();
    await invoke("uninstall_runtime_module", { moduleId });
  },
};

export type RuntimeModuleApi = typeof runtimeModuleApi;
