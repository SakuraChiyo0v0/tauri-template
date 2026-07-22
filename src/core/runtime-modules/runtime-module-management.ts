import type { RegisteredFeature } from "@/core/features/feature-types";
import type { RuntimeModuleDiagnostic } from "./runtime-module-types";

export type ModuleManagementStatus = "active" | "disabled" | "waiting" | "blocked";

export interface ModuleManagementState {
  sourceLabel: "内置" | "运行时";
  status: ModuleManagementStatus;
  statusLabel: string;
  version: string;
  error: string | null;
  diagnosticMessages: string[];
  requiredDependencies: string[];
  optionalDependencies: string[];
  dependents: string[];
  availableVersions: string[];
  toggleChecked: boolean;
  canToggle: boolean;
  canRollback: boolean;
  canUninstall: boolean;
  permissionSummary: string[];
  permissionVersion: string | null;
  canApprovePermissions: boolean;
  canRevokePermissions: boolean;
}

export function formatRuntimeDiagnostic(diagnostic: RuntimeModuleDiagnostic) {
  if (diagnostic.code === "waiting_permission") {
    return "等待批准原生能力";
  }
  if (diagnostic.code === "missing_dependency") {
    return `缺少 ${diagnostic.dependencyId ?? "未知模块"}（需要 ${diagnostic.requiredVersion ?? "兼容版本"}）`;
  }
  if (diagnostic.code === "incompatible_dependency") {
    const available = diagnostic.availableVersions.length > 0 ? diagnostic.availableVersions.join("、") : "无";
    return `${diagnostic.dependencyId ?? "依赖模块"} 版本不兼容：需要 ${diagnostic.requiredVersion ?? "兼容版本"}，本机有 ${available}`;
  }
  if (diagnostic.code === "dependency_cycle") {
    return `依赖循环：${diagnostic.relatedModules.join(" → ")}`;
  }
  if (diagnostic.code === "upstream_activation_failed") {
    return `上游模块激活失败：${diagnostic.relatedModules.join("、")}`;
  }
  return "依赖组合过于复杂，已保留上一次可用计划";
}

export function getModuleManagementState(feature: RegisteredFeature, enabled: boolean): ModuleManagementState {
  const runtime = feature.runtime;
  const isRuntime = feature.source === "runtime" && runtime !== undefined;
  const status: ModuleManagementStatus = isRuntime
    ? runtime.status
    : enabled ? "active" : "disabled";
  const labels: Record<ModuleManagementStatus, string> = {
    active: "已启用",
    disabled: "已停用",
    waiting: "等待依赖",
    blocked: "激活受阻",
  };

  return {
    sourceLabel: isRuntime ? "运行时" : "内置",
    status,
    statusLabel: runtime?.permissionStatus === "awaiting_approval"
      ? status === "active" ? "运行中 · 更新待授权" : "等待权限"
      : labels[status],
    version: runtime?.selectedVersion ?? runtime?.manifest.version ?? feature.version,
    error: runtime?.lastError?.message ?? null,
    diagnosticMessages: runtime?.diagnostics.map(formatRuntimeDiagnostic) ?? [],
    requiredDependencies: runtime?.requiredDependencies.map((dependency) => `${dependency.id} ${dependency.version}`) ?? [],
    optionalDependencies: runtime?.optionalDependencies.map((dependency) => `${dependency.id} ${dependency.version}`) ?? [],
    dependents: runtime?.dependents ?? [],
    availableVersions: runtime?.availableVersions ?? [feature.version],
    toggleChecked: runtime?.desiredEnabled ?? enabled,
    canToggle: feature.canDisable !== false,
    canRollback: isRuntime && runtime.previousSelectedVersion !== null && runtime.status === "active",
    canUninstall: isRuntime,
    permissionSummary: runtime?.nativePermissionSummary ?? [],
    permissionVersion: runtime?.permissionVersion ?? null,
    canApprovePermissions: runtime?.permissionStatus === "awaiting_approval",
    canRevokePermissions: runtime?.permissionStatus === "approved",
  };
}
