import type { ThemeState } from "@/themes/theme-types";
import type { LogLevel } from "@/features/logging/logger";
import type { RuntimeModuleDependency, RuntimeModuleManifest } from "./runtime-manifest";

export interface RuntimeModuleError {
  version: string;
  message: string;
  occurredAt: string;
}

export type RuntimeModuleStatus = "active" | "disabled" | "waiting" | "blocked";

export type RuntimeModuleDiagnosticCode =
  | "missing_dependency"
  | "incompatible_dependency"
  | "dependency_cycle"
  | "upstream_activation_failed"
  | "resolution_limit";

export interface RuntimeModuleDiagnostic {
  code: RuntimeModuleDiagnosticCode;
  moduleId: string;
  dependencyId: string | null;
  requiredVersion: string | null;
  availableVersions: string[];
  relatedModules: string[];
}

export interface RuntimeModuleActivationPlan {
  generation: number;
  desiredEnabled: Record<string, boolean>;
  selectedVersions: Record<string, string>;
  previousSelectedVersions: Record<string, string>;
  activationOrder: string[];
  diagnostics: Record<string, RuntimeModuleDiagnostic[]>;
}

export interface InstalledRuntimeModule {
  manifest: RuntimeModuleManifest;
  desiredEnabled: boolean;
  selectedVersion: string | null;
  previousSelectedVersion: string | null;
  selectedSha256: string | null;
  status: RuntimeModuleStatus;
  diagnostics: RuntimeModuleDiagnostic[];
  requiredDependencies: RuntimeModuleDependency[];
  optionalDependencies: RuntimeModuleDependency[];
  dependents: string[];
  activeVersion: string;
  previousVersion: string | null;
  availableVersions: string[];
  activeSha256: string;
  blockedVersion: string | null;
  lastError: RuntimeModuleError | null;
}

export interface RuntimeModulePlanSnapshot {
  plan: RuntimeModuleActivationPlan;
  modules: InstalledRuntimeModule[];
}

export interface RuntimeModuleOperationResult extends RuntimeModulePlanSnapshot {
  moduleId: string;
  packageInstalled: boolean;
  planChanged: boolean;
}

export type RuntimeModuleImpactCode =
  | "required_by_enabled_modules"
  | "required_by_installed_modules"
  | "rollback_requires_coordinated_change";

export interface RuntimeModuleImpact {
  code: RuntimeModuleImpactCode;
  moduleId: string;
  relatedModules: string[];
  selectedVersion: string | null;
  requestedVersion: string | null;
}

export interface RuntimeModuleEntry {
  manifest: RuntimeModuleManifest;
  source: string;
}

export interface ActivationFailureResult {
  module: InstalledRuntimeModule;
  rolledBack: boolean;
}

export interface RuntimeModuleLogger {
  trace(message: string): Promise<void>;
  debug(message: string): Promise<void>;
  info(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  error(message: string): Promise<void>;
  write(level: LogLevel, message: string): Promise<void>;
}

export type RuntimeSqlValue = null | boolean | number | string | number[];

export interface RuntimeDatabaseStatement {
  sql: string;
  params?: RuntimeSqlValue[];
}

export interface RuntimeDatabaseExecuteResult {
  rowsAffected: number;
  lastInsertId: number;
}

export interface RuntimeModuleDatabaseBackend {
  execute(moduleId: string, sql: string, params: RuntimeSqlValue[]): Promise<RuntimeDatabaseExecuteResult>;
  select<T extends Record<string, RuntimeSqlValue>>(moduleId: string, sql: string, params: RuntimeSqlValue[]): Promise<T[]>;
  transaction(moduleId: string, statements: RuntimeDatabaseStatement[]): Promise<RuntimeDatabaseExecuteResult[]>;
  getUserVersion(moduleId: string): Promise<number>;
  setUserVersion(moduleId: string, version: number): Promise<void>;
}

export interface RuntimeModuleDatabase {
  execute(sql: string, params?: RuntimeSqlValue[]): Promise<RuntimeDatabaseExecuteResult>;
  select<T extends Record<string, RuntimeSqlValue>>(sql: string, params?: RuntimeSqlValue[]): Promise<T[]>;
  transaction(statements: RuntimeDatabaseStatement[]): Promise<RuntimeDatabaseExecuteResult[]>;
  getUserVersion(): Promise<number>;
  setUserVersion(version: number): Promise<void>;
}

interface RuntimeModuleHostSdkBase {
  readonly hostVersion: string;
  readonly module: {
    readonly id: string;
    readonly version: string;
  };
  readonly logger: RuntimeModuleLogger;
  readonly settings: {
    get<T>(settingId: string, defaultValue: T): T;
    set(settingId: string, value: unknown): void;
    subscribe(listener: () => void): () => void;
  };
  readonly theme: {
    get(): ThemeState;
    subscribe(listener: (theme: ThemeState) => void): () => void;
  };
}

export interface RuntimeModuleHostSdkV1 extends RuntimeModuleHostSdkBase {
  readonly sdkVersion: 1;
}

export interface RuntimeModuleHostSdkV2 extends RuntimeModuleHostSdkBase {
  readonly sdkVersion: 2;
  readonly database: RuntimeModuleDatabase;
}

export type RuntimeModuleHostSdk = RuntimeModuleHostSdkV1 | RuntimeModuleHostSdkV2;

export interface ModuleDataInventoryItem {
  moduleId: string;
  sizeBytes: number;
  installed: boolean;
}

export interface RuntimeModuleExports {
  activate(hostSdk: RuntimeModuleHostSdk): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
