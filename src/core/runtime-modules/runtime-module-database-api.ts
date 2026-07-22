import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  RuntimeDatabaseExecuteResult,
  RuntimeDatabaseStatement,
  RuntimeModuleDatabaseBackend,
  RuntimeSqlValue,
} from "./runtime-module-types";

function requireTauri() {
  if (!isTauri()) throw new Error("模块数据库只能在 Tauri 桌面应用中使用。");
}

export const runtimeModuleDatabaseApi: RuntimeModuleDatabaseBackend = {
  async execute(moduleId, sql, params) {
    requireTauri();
    return invoke<RuntimeDatabaseExecuteResult>("execute_runtime_module_database", { moduleId, sql, params });
  },
  async select<T extends Record<string, RuntimeSqlValue>>(moduleId: string, sql: string, params: RuntimeSqlValue[]) {
    requireTauri();
    return invoke<T[]>("select_runtime_module_database", { moduleId, sql, params });
  },
  async transaction(moduleId, statements: RuntimeDatabaseStatement[]) {
    requireTauri();
    return invoke<RuntimeDatabaseExecuteResult[]>("transact_runtime_module_database", { moduleId, statements });
  },
  async getUserVersion(moduleId) {
    requireTauri();
    return invoke<number>("get_runtime_module_database_user_version", { moduleId });
  },
  async setUserVersion(moduleId, version) {
    requireTauri();
    await invoke("set_runtime_module_database_user_version", { moduleId, version });
  },
};
