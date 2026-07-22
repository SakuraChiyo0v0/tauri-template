import packageMetadata from "../../../package.json";
import { createModuleLogger } from "@/features/logging/logger";
import { getSetting, setSetting, subscribeSettings } from "@/core/settings/setting-store";
import { getThemeSnapshot, subscribeTheme } from "@/themes/theme-store";
import type { InstalledRuntimeModule, RuntimeModuleHostSdk } from "./runtime-module-types";

export function createRuntimeModuleHostSdk(module: InstalledRuntimeModule): RuntimeModuleHostSdk {
  const moduleId = module.manifest.id;

  return {
    sdkVersion: 1,
    hostVersion: packageMetadata.version,
    module: {
      id: moduleId,
      version: module.activeVersion,
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
}
