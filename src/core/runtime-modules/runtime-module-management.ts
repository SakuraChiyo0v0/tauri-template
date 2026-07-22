import type { RegisteredFeature } from "@/core/features/feature-types";

export type ModuleManagementStatus = "active" | "disabled" | "failed";

export interface ModuleManagementState {
  sourceLabel: "内置" | "运行时";
  status: ModuleManagementStatus;
  statusLabel: string;
  version: string;
  error: string | null;
  canToggle: boolean;
  canRollback: boolean;
  canUninstall: boolean;
}

export function getModuleManagementState(feature: RegisteredFeature, enabled: boolean): ModuleManagementState {
  const runtime = feature.runtime;
  const isRuntime = feature.source === "runtime" && runtime !== undefined;
  const failed = isRuntime && runtime.blockedVersion === runtime.activeVersion;
  const status: ModuleManagementStatus = failed ? "failed" : enabled ? "active" : "disabled";

  return {
    sourceLabel: isRuntime ? "运行时" : "内置",
    status,
    statusLabel: status === "failed" ? "激活失败" : status === "active" ? "已启用" : "已停用",
    version: feature.runtime?.activeVersion ?? feature.version,
    error: feature.runtime?.lastError?.message ?? null,
    canToggle: feature.canDisable !== false && !failed,
    canRollback: isRuntime && runtime.previousVersion !== null,
    canUninstall: isRuntime,
  };
}
