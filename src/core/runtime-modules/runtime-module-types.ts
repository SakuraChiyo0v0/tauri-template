import type { ThemeState } from "@/themes/theme-types";
import type { LogLevel } from "@/features/logging/logger";
import type { SupportedLocale } from "@/core/i18n/locale-store";
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
  | "resolution_limit"
  | "waiting_permission";

export type RuntimeModulePermissionStatus = "not_required" | "awaiting_approval" | "approved";

export type NativePermissionSummary =
  | { kind: "private_filesystem" }
  | { kind: "external_filesystem"; access: string[] }
  | { kind: "url_schemes"; schemes: string[] }
  | { kind: "executable_grants" }
  | { kind: "registry"; hive: string; key: string; access: "read" | "read_write" }
  | { kind: "tray"; count: number }
  | { kind: "shortcuts"; count: number }
  | { kind: "module_repository_install" }
  | { kind: "notifications" }
  | { kind: "clipboard" }
  | { kind: "http"; origins: string[] };

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
  permissionStatus: RuntimeModulePermissionStatus;
  permissionVersion: string | null;
  nativePermissionSummary: NativePermissionSummary[];
  nativePermissionFingerprint: string | null;
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

export type RuntimeServiceValue =
  | null
  | boolean
  | number
  | string
  | RuntimeServiceValue[]
  | { [key: string]: RuntimeServiceValue };

export type RuntimeServiceHandler = (
  input: RuntimeServiceValue,
) => RuntimeServiceValue | Promise<RuntimeServiceValue>;

export interface RuntimeModuleServices {
  expose(serviceId: string, handlers: Record<string, RuntimeServiceHandler>): () => void;
  available(providerModuleId: string, serviceId: string): boolean;
  call<T extends RuntimeServiceValue = RuntimeServiceValue>(
    providerModuleId: string,
    serviceId: string,
    method: string,
    input?: RuntimeServiceValue,
  ): Promise<T>;
}

export interface RuntimeModuleEventEnvelope {
  readonly eventId: string;
  readonly publisherModuleId: string;
  readonly publishedAt: string;
  readonly payload: RuntimeServiceValue;
}

export interface RuntimeModuleEvents {
  publish(eventId: string, payload?: RuntimeServiceValue): void;
  subscribe(eventId: string, listener: (event: RuntimeModuleEventEnvelope) => void): () => void;
}

export interface RuntimeFileGrant {
  id: string;
  moduleId: string;
  displayName: string;
  kind: "file" | "directory" | "executable";
  access: { read: boolean; write: boolean; list: boolean; execute: boolean };
}

export interface RuntimeDirectoryEntry {
  name: string;
  kind: "file" | "directory" | "executable";
}

export interface RuntimeProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type RuntimeRegistryValue =
  | { type: "string"; value: string }
  | { type: "dword" | "qword"; value: number }
  | { type: "binary"; value: number[] }
  | { type: "multi-string"; value: string[] };

export interface RuntimeTrayItemUpdate {
  label?: string;
  enabled?: boolean;
  checked?: boolean;
}

export interface RuntimeShortcutStatus {
  shortcutId: string;
  accelerator: string | null;
  state: "registered" | "conflict" | "disabled";
}

export type RuntimeModuleRepositoryPackageStatus =
  | "not_installed"
  | "update_available"
  | "installed"
  | "older_version"
  | "invalid";

export interface RuntimeModuleRepositoryPackage {
  fileName: string;
  manifest: RuntimeModuleManifest | null;
  installedVersion: string | null;
  status: RuntimeModuleRepositoryPackageStatus;
  permissionSummary: NativePermissionSummary[];
  error: string | null;
}

export interface RuntimeModuleRepositoryInstallResult {
  moduleId: string;
  version: string;
  selectedVersion: string | null;
  status: RuntimeModuleStatus;
  packageInstalled: boolean;
  planChanged: boolean;
}

export type RuntimeModuleRepositoryPlanAction = "keep" | "install" | "upgrade";

export interface RuntimeModuleRepositoryPlanDiagnostic {
  code: string;
  moduleId: string;
  dependencyId: string | null;
  requiredVersion: string | null;
  availableVersions: string[];
  relatedModules: string[];
}

export interface RuntimeModuleRepositoryPlanEntry {
  moduleId: string;
  name: RuntimeModuleManifest["name"];
  version: string;
  currentVersion: string | null;
  action: RuntimeModuleRepositoryPlanAction;
  requiredDependencies: RuntimeModuleDependency[];
  permissionSummary: NativePermissionSummary[];
  requiresPermissionApproval: boolean;
}

export interface RuntimeModuleRepositoryInstallPlan {
  planId: string;
  targetModuleId: string;
  targetVersion: string;
  executable: boolean;
  entries: RuntimeModuleRepositoryPlanEntry[];
  activationOrder: string[];
  diagnostics: RuntimeModuleRepositoryPlanDiagnostic[];
}

export interface RuntimeModuleRepositoryInstallPlanResult {
  targetModuleId: string;
  planChanged: boolean;
  modules: Array<{ moduleId: string; version: string; status: RuntimeModuleStatus }>;
}

export interface RuntimeModuleNativeBackend {
  createSession(moduleId: string, version: string): Promise<string>;
  releaseSession(sessionToken: string): Promise<void>;
  readPrivateFile(sessionToken: string, path: string): Promise<number[]>;
  writePrivateFile(sessionToken: string, path: string, data: number[]): Promise<number>;
  listFileGrants(sessionToken: string): Promise<RuntimeFileGrant[]>;
  readGrantedFile(sessionToken: string, grantId: string): Promise<number[]>;
  writeGrantedFile(sessionToken: string, grantId: string, data: number[]): Promise<number>;
  listGrantedDirectory(sessionToken: string, grantId: string): Promise<RuntimeDirectoryEntry[]>;
  revokeFileGrant(sessionToken: string, grantId: string): Promise<void>;
  openUrl(sessionToken: string, url: string): Promise<void>;
  openPath(sessionToken: string, grantId: string): Promise<void>;
  revealInFolder(sessionToken: string, grantId: string): Promise<void>;
  runProcess(sessionToken: string, grantId: string, arguments_: string[], timeoutMs?: number): Promise<RuntimeProcessResult>;
  readRegistry(sessionToken: string, hive: "HKCU" | "HKLM", key: string, name: string): Promise<RuntimeRegistryValue>;
  writeRegistry(sessionToken: string, hive: "HKCU", key: string, name: string, value: RuntimeRegistryValue): Promise<void>;
  deleteRegistryValue(sessionToken: string, hive: "HKCU", key: string, name: string): Promise<void>;
  updateTrayItem(sessionToken: string, itemId: string, update: RuntimeTrayItemUpdate): Promise<void>;
  listShortcuts(sessionToken: string): Promise<RuntimeShortcutStatus[]>;
  rebindShortcut(sessionToken: string, shortcutId: string, accelerator: string): Promise<RuntimeShortcutStatus[]>;
  disableShortcut(sessionToken: string, shortcutId: string): Promise<RuntimeShortcutStatus[]>;
  createModuleRepositoryGrant(sessionToken: string, path: string): Promise<RuntimeFileGrant>;
  scanModuleRepository(sessionToken: string, grantId: string): Promise<RuntimeModuleRepositoryPackage[]>;
  installModuleFromRepository(sessionToken: string, grantId: string, fileName: string): Promise<RuntimeModuleRepositoryInstallResult>;
  previewModuleRepositoryInstall(sessionToken: string, grantId: string, fileName: string): Promise<RuntimeModuleRepositoryInstallPlan>;
  executeModuleRepositoryInstallPlan(sessionToken: string, grantId: string, planId: string): Promise<RuntimeModuleRepositoryInstallPlanResult>;
  showNotification(sessionToken: string, notification: RuntimeModuleNotification): Promise<void>;
  exportModuleBackup(sessionToken: string, settingsJson: string, targetPath: string): Promise<{ moduleId: string; fileName: string; size: number }>;
  importModuleBackup(sessionToken: string, sourcePath: string): Promise<{ moduleId: string; settingsJson: string; databaseSize: number }>;
  readClipboard(sessionToken: string): Promise<string>;
  writeClipboard(sessionToken: string, text: string): Promise<void>;
  fetchHttp(sessionToken: string, request: RuntimeModuleHttpRequest): Promise<{ moduleId: string; response: RuntimeModuleHttpResponse | null; error: string | null }>;
  onTrayAction(moduleId: string, listener: (itemId: string) => void): Promise<() => void>;
  onShortcutTrigger(moduleId: string, listener: (shortcutId: string) => void): Promise<() => void>;
}

export interface RuntimeModuleHostSdkBase {
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
  readonly i18n: {
    getLocale(): SupportedLocale;
    subscribe(listener: (locale: SupportedLocale) => void): () => void;
  };
}

export interface RuntimeModuleHostSdkV2 extends RuntimeModuleHostSdkBase {
  readonly sdkVersion: 2;
  readonly database: RuntimeModuleDatabase;
}

interface RuntimeModuleNativeApis {
  readonly database: RuntimeModuleDatabase;
  readonly filesystem: {
    readPrivate(path: string): Promise<number[]>;
    writePrivate(path: string, data: number[]): Promise<number>;
    listGrants(): Promise<RuntimeFileGrant[]>;
    readGrant(grantId: string): Promise<number[]>;
    writeGrant(grantId: string, data: number[]): Promise<number>;
    listDirectory(grantId: string): Promise<RuntimeDirectoryEntry[]>;
    revokeGrant(grantId: string): Promise<void>;
  };
  readonly process: {
    openUrl(url: string): Promise<void>;
    openPath(grantId: string): Promise<void>;
    revealInFolder(grantId: string): Promise<void>;
    run(grantId: string, arguments_?: string[], timeoutMs?: number): Promise<RuntimeProcessResult>;
  };
  readonly registry: {
    read(hive: "HKCU" | "HKLM", key: string, name: string): Promise<RuntimeRegistryValue>;
    write(key: string, name: string, value: RuntimeRegistryValue): Promise<void>;
    deleteValue(key: string, name: string): Promise<void>;
  };
  readonly tray: {
    update(itemId: string, update: RuntimeTrayItemUpdate): Promise<void>;
    onAction(listener: (itemId: string) => void): Promise<() => void>;
  };
  readonly shortcuts: {
    list(): Promise<RuntimeShortcutStatus[]>;
    rebind(shortcutId: string, accelerator: string): Promise<RuntimeShortcutStatus[]>;
    disable(shortcutId: string): Promise<RuntimeShortcutStatus[]>;
    onTrigger(listener: (shortcutId: string) => void): Promise<() => void>;
  };
}

export interface RuntimeModuleHostSdkV3 extends RuntimeModuleHostSdkBase, RuntimeModuleNativeApis {
  readonly sdkVersion: 3;
}

export interface RuntimeModuleHostSdkV4 extends RuntimeModuleHostSdkBase, RuntimeModuleNativeApis {
  readonly sdkVersion: 4;
  readonly services: RuntimeModuleServices;
}

export interface RuntimeModuleHostSdkV5 extends Omit<RuntimeModuleHostSdkV4, "sdkVersion"> {
  readonly sdkVersion: 5;
  readonly moduleRepository: {
    chooseDirectory(): Promise<RuntimeFileGrant | null>;
    scan(grantId: string): Promise<RuntimeModuleRepositoryPackage[]>;
    install(grantId: string, fileName: string): Promise<RuntimeModuleRepositoryInstallResult>;
  };
}

export interface RuntimeModuleHostSdkV6 extends Omit<RuntimeModuleHostSdkV5, "sdkVersion" | "moduleRepository"> {
  readonly sdkVersion: 6;
  readonly moduleRepository: RuntimeModuleHostSdkV5["moduleRepository"] & {
    previewInstallPlan(grantId: string, fileName: string): Promise<RuntimeModuleRepositoryInstallPlan>;
    executeInstallPlan(grantId: string, planId: string): Promise<RuntimeModuleRepositoryInstallPlanResult>;
  };
}

export interface RuntimeModuleHostSdkV7 extends Omit<RuntimeModuleHostSdkV6, "sdkVersion"> {
  readonly sdkVersion: 7;
  readonly events: RuntimeModuleEvents;
}

export interface RuntimeModuleNotification {
  title: string;
  body?: string;
}

export interface RuntimeModuleNotifications {
  show(notification: RuntimeModuleNotification): Promise<void>;
}

export interface RuntimeModuleHostSdkV8 extends Omit<RuntimeModuleHostSdkV7, "sdkVersion"> {
  readonly sdkVersion: 8;
  readonly notifications: RuntimeModuleNotifications;
}

export interface RuntimeModuleDataBackupSummary {
  readonly grantId: string;
  readonly displayName: string;
  readonly size: number;
}

export interface RuntimeModuleData {
  exportBackup(): Promise<RuntimeModuleDataBackupSummary | null>;
  importBackup(grantId: string): Promise<void>;
}

export interface RuntimeModuleHostSdkV9 extends Omit<RuntimeModuleHostSdkV8, "sdkVersion"> {
  readonly sdkVersion: 9;
  readonly data: RuntimeModuleData;
}

export interface RuntimeModuleClipboard {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export interface RuntimeModuleHostSdkV10 extends Omit<RuntimeModuleHostSdkV9, "sdkVersion"> {
  readonly sdkVersion: 10;
  readonly clipboard: RuntimeModuleClipboard;
}

export interface RuntimeModuleConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface RuntimeModulePromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface RuntimeModuleDialogs {
  confirm(options: RuntimeModuleConfirmOptions): Promise<boolean>;
  prompt(options: RuntimeModulePromptOptions): Promise<string | null>;
}

export interface RuntimeModuleHostSdkV11 extends Omit<RuntimeModuleHostSdkV10, "sdkVersion"> {
  readonly sdkVersion: 11;
  readonly dialogs: RuntimeModuleDialogs;
}

export interface RuntimeModuleHttpRequest {
  url: string;
  method?: string;
  headers?: Array<[string, string]>;
  body?: number[];
  timeoutMs?: number;
}

export interface RuntimeModuleHttpResponse {
  status: number;
  headers: Array<[string, string]>;
  body: number[];
  truncated: boolean;
}

export interface RuntimeModuleHttp {
  fetch(options: RuntimeModuleHttpRequest): Promise<RuntimeModuleHttpResponse>;
}

export interface RuntimeModuleHostSdkV12 extends Omit<RuntimeModuleHostSdkV11, "sdkVersion"> {
  readonly sdkVersion: 12;
  readonly http: RuntimeModuleHttp;
}

export type RuntimeModuleHostSdk =
  | RuntimeModuleHostSdkV2
  | RuntimeModuleHostSdkV3
  | RuntimeModuleHostSdkV4
  | RuntimeModuleHostSdkV5
  | RuntimeModuleHostSdkV6
  | RuntimeModuleHostSdkV7
  | RuntimeModuleHostSdkV8
  | RuntimeModuleHostSdkV9
  | RuntimeModuleHostSdkV10
  | RuntimeModuleHostSdkV11
  | RuntimeModuleHostSdkV12;

export interface ModuleDataInventoryItem {
  moduleId: string;
  sizeBytes: number;
  installed: boolean;
}

export interface RuntimeModuleExports {
  activate(hostSdk: RuntimeModuleHostSdk): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
