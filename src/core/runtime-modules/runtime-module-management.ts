import type { RegisteredFeature } from "@/core/features/feature-types";
import { getLocaleSnapshot, type SupportedLocale } from "@/core/i18n/locale-store";
import { translate } from "@/core/i18n/messages";
import type { NativePermissionSummary, RuntimeModuleDiagnostic } from "./runtime-module-types";

export type ModuleManagementStatus = "active" | "disabled" | "waiting" | "blocked";

export interface ModuleManagementState {
  sourceLabel: string;
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
  permissionSummary: NativePermissionSummary[];
  permissionVersion: string | null;
  canApprovePermissions: boolean;
  canRevokePermissions: boolean;
}

export function formatRuntimeDiagnostic(diagnostic: RuntimeModuleDiagnostic, locale: SupportedLocale = getLocaleSnapshot()) {
  const listSeparator = locale === "zh-CN" ? "、" : ", ";
  if (diagnostic.code === "waiting_permission") {
    return translate(locale, "diagnostic.waitingPermission");
  }
  if (diagnostic.code === "missing_dependency") {
    return translate(locale, "diagnostic.missingDependency", {
      module: diagnostic.dependencyId ?? translate(locale, "diagnostic.unknownModule"),
      version: diagnostic.requiredVersion ?? translate(locale, "diagnostic.compatibleVersion"),
    });
  }
  if (diagnostic.code === "incompatible_dependency") {
    return translate(locale, "diagnostic.incompatibleDependency", {
      module: diagnostic.dependencyId ?? translate(locale, "diagnostic.dependencyModule"),
      version: diagnostic.requiredVersion ?? translate(locale, "diagnostic.compatibleVersion"),
      available: diagnostic.availableVersions.length > 0 ? diagnostic.availableVersions.join(listSeparator) : translate(locale, "common.none"),
    });
  }
  if (diagnostic.code === "dependency_cycle") {
    return translate(locale, "diagnostic.dependencyCycle", { modules: diagnostic.relatedModules.join(" → ") });
  }
  if (diagnostic.code === "upstream_activation_failed") {
    return translate(locale, "diagnostic.upstreamFailed", { modules: diagnostic.relatedModules.join(listSeparator) });
  }
  return translate(locale, "diagnostic.tooComplex");
}

export function getModuleManagementState(
  feature: RegisteredFeature,
  enabled: boolean,
  locale: SupportedLocale = getLocaleSnapshot(),
): ModuleManagementState {
  const runtime = feature.runtime;
  const isRuntime = feature.source === "runtime" && runtime !== undefined;
  const status: ModuleManagementStatus = isRuntime
    ? runtime.status
    : enabled ? "active" : "disabled";
  const labels: Record<ModuleManagementStatus, string> = {
    active: translate(locale, "modules.status.active"),
    disabled: translate(locale, "modules.status.disabled"),
    waiting: translate(locale, "modules.status.waiting"),
    blocked: translate(locale, "modules.status.blocked"),
  };

  return {
    sourceLabel: translate(locale, isRuntime ? "modules.source.runtime" : "modules.source.builtin"),
    status,
    statusLabel: runtime?.permissionStatus === "awaiting_approval"
      ? status === "active" ? translate(locale, "modules.status.activePendingPermission") : translate(locale, "modules.status.awaitingPermission")
      : labels[status],
    version: runtime?.selectedVersion ?? runtime?.manifest.version ?? feature.version,
    error: runtime?.lastError?.message ?? null,
    diagnosticMessages: runtime?.diagnostics.map((diagnostic) => formatRuntimeDiagnostic(diagnostic, locale)) ?? [],
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
