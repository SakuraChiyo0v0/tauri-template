import packageMetadata from "../../../package.json";
import { createModuleLogger } from "@/features/logging/logger";
import { getSetting, setSetting, subscribeSettings } from "@/core/settings/setting-store";
import { getThemeSnapshot, subscribeTheme } from "@/themes/theme-store";
import { runtimeModuleDatabaseApi } from "./runtime-module-database-api";
import type {
  InstalledRuntimeModule,
  RuntimeModuleDatabaseBackend,
  RuntimeModuleHostSdk,
  RuntimeModuleHostSdkV1,
} from "./runtime-module-types";

export function createRuntimeModuleHostSdk(
  module: InstalledRuntimeModule,
  databaseBackend: RuntimeModuleDatabaseBackend = runtimeModuleDatabaseApi,
): RuntimeModuleHostSdk {
  const moduleId = module.manifest.id;

  const base: Omit<RuntimeModuleHostSdkV1, "sdkVersion"> = {
    hostVersion: packageMetadata.version,
    module: {
      id: moduleId,
      version: module.selectedVersion ?? module.manifest.version,
    },
    logger: createModuleLogger(moduleId),
    settings: {
      get: <T,>(settingId: string, defaultValue: T) => getSetting(moduleId, settingId, defaultValue),
      set: (settingId, value) => setSetting(moduleId, settingId, value),
      subscribe: subscribeSettings,
    },
    theme: {
      get: getThemeSnapshot,
      subscribe(listener) {
        return subscribeTheme(() => listener(getThemeSnapshot()));
      },
    },
  };

  if (module.manifest.sdkVersion === 1) return { ...base, sdkVersion: 1 };
  return {
    ...base,
    sdkVersion: 2,
    database: {
      execute: (sql, params = []) => databaseBackend.execute(moduleId, sql, params),
      select: (sql, params = []) => databaseBackend.select(moduleId, sql, params),
      transaction: (statements) => databaseBackend.transaction(moduleId, statements),
      getUserVersion: () => databaseBackend.getUserVersion(moduleId),
      setUserVersion: (version) => databaseBackend.setUserVersion(moduleId, version),
    },
  };
}
