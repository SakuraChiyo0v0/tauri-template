import type { ThemeState } from "@/themes/theme-types";
import type { LogLevel } from "@/features/logging/logger";
import type { RuntimeModuleManifest } from "./runtime-manifest";

export interface RuntimeModuleError {
  version: string;
  message: string;
  occurredAt: string;
}

export interface InstalledRuntimeModule {
  manifest: RuntimeModuleManifest;
  activeVersion: string;
  previousVersion: string | null;
  availableVersions: string[];
  activeSha256: string;
  blockedVersion: string | null;
  lastError: RuntimeModuleError | null;
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

export interface RuntimeModuleHostSdk {
  readonly sdkVersion: 1;
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

export interface RuntimeModuleExports {
  activate(hostSdk: RuntimeModuleHostSdk): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
