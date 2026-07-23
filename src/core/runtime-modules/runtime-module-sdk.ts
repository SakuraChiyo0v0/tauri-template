import packageMetadata from "../../../package.json";
import { open } from "@tauri-apps/plugin-dialog";
import { createModuleLogger } from "@/features/logging/logger";
import { getSetting, setSetting, subscribeSettings } from "@/core/settings/setting-store";
import { getThemeSnapshot, subscribeTheme } from "@/themes/theme-store";
import { getLocaleSnapshot, subscribeLocale } from "@/core/i18n/locale-store";
import { runtimeModuleDatabaseApi } from "./runtime-module-database-api";
import { runtimeModuleNativeApi } from "./runtime-module-native-api";
import { runtimeModuleServiceBus, type RuntimeModuleServiceBus } from "./runtime-module-services";
import type {
  InstalledRuntimeModule,
  RuntimeDatabaseStatement,
  RuntimeModuleDatabaseBackend,
  RuntimeModuleHostSdk,
  RuntimeModuleHostSdkV2,
  RuntimeModuleHostSdkV3,
  RuntimeModuleNativeBackend,
  RuntimeSqlValue,
} from "./runtime-module-types";

export type RuntimeModuleRepositoryDirectoryPicker = () => Promise<string | null>;

const defaultRepositoryDirectoryPicker: RuntimeModuleRepositoryDirectoryPicker = async () => {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
};

const nativeSessions = new WeakMap<RuntimeModuleHostSdk, {
  backend: RuntimeModuleNativeBackend;
  token: string;
  cleanups: Set<() => void>;
  releaseServices?: () => void;
}>();

function databaseApi(moduleId: string, backend: RuntimeModuleDatabaseBackend) {
  return {
    execute: (sql: string, params: RuntimeSqlValue[] = []) => backend.execute(moduleId, sql, params),
    select: <T extends Record<string, RuntimeSqlValue>>(sql: string, params: RuntimeSqlValue[] = []) => backend.select<T>(moduleId, sql, params),
    transaction: (statements: RuntimeDatabaseStatement[]) => backend.transaction(moduleId, statements),
    getUserVersion: () => backend.getUserVersion(moduleId),
    setUserVersion: (version: number) => backend.setUserVersion(moduleId, version),
  };
}

export async function createRuntimeModuleHostSdk(
  module: InstalledRuntimeModule,
  databaseBackend: RuntimeModuleDatabaseBackend = runtimeModuleDatabaseApi,
  nativeBackend: RuntimeModuleNativeBackend = runtimeModuleNativeApi,
  serviceBus: RuntimeModuleServiceBus = runtimeModuleServiceBus,
  repositoryDirectoryPicker: RuntimeModuleRepositoryDirectoryPicker = defaultRepositoryDirectoryPicker,
): Promise<RuntimeModuleHostSdk> {
  const moduleId = module.manifest.id;
  const base: Omit<RuntimeModuleHostSdkV2, "sdkVersion" | "database"> = {
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
    i18n: {
      getLocale: getLocaleSnapshot,
      subscribe(listener) {
        return subscribeLocale(() => listener(getLocaleSnapshot()));
      },
    },
  };

  if (module.manifest.sdkVersion === 2) {
    return { ...base, sdkVersion: 2, database: databaseApi(moduleId, databaseBackend) };
  }

  const version = module.selectedVersion ?? module.manifest.version;
  const token = await nativeBackend.createSession(moduleId, version);
  const cleanups = new Set<() => void>();
  const trackedListener = async (subscribe: () => Promise<() => void>) => {
    const unsubscribe = await subscribe();
    cleanups.add(unsubscribe);
    return () => {
      cleanups.delete(unsubscribe);
      unsubscribe();
    };
  };
  const nativeApis: Omit<RuntimeModuleHostSdkV3, "sdkVersion"> = {
    ...base,
    database: databaseApi(moduleId, databaseBackend),
    filesystem: {
      readPrivate: (path) => nativeBackend.readPrivateFile(token, path),
      writePrivate: (path, data) => nativeBackend.writePrivateFile(token, path, data),
      listGrants: () => nativeBackend.listFileGrants(token),
      readGrant: (grantId) => nativeBackend.readGrantedFile(token, grantId),
      writeGrant: (grantId, data) => nativeBackend.writeGrantedFile(token, grantId, data),
      listDirectory: (grantId) => nativeBackend.listGrantedDirectory(token, grantId),
      revokeGrant: (grantId) => nativeBackend.revokeFileGrant(token, grantId),
    },
    process: {
      openUrl: (url) => nativeBackend.openUrl(token, url),
      openPath: (grantId) => nativeBackend.openPath(token, grantId),
      revealInFolder: (grantId) => nativeBackend.revealInFolder(token, grantId),
      run: (grantId, arguments_ = [], timeoutMs) => nativeBackend.runProcess(token, grantId, arguments_, timeoutMs),
    },
    registry: {
      read: (hive, key, name) => nativeBackend.readRegistry(token, hive, key, name),
      write: (key, name, value) => nativeBackend.writeRegistry(token, "HKCU", key, name, value),
      deleteValue: (key, name) => nativeBackend.deleteRegistryValue(token, "HKCU", key, name),
    },
    tray: {
      update: (itemId, update) => nativeBackend.updateTrayItem(token, itemId, update),
      onAction: (listener) => trackedListener(() => nativeBackend.onTrayAction(moduleId, listener)),
    },
    shortcuts: {
      list: () => nativeBackend.listShortcuts(token),
      rebind: (shortcutId, accelerator) => nativeBackend.rebindShortcut(token, shortcutId, accelerator),
      disable: (shortcutId) => nativeBackend.disableShortcut(token, shortcutId),
      onTrigger: (listener) => trackedListener(() => nativeBackend.onShortcutTrigger(moduleId, listener)),
    },
  };

  const services = module.manifest.sdkVersion >= 4
    ? serviceBus.createModuleApi(
        moduleId,
        module.manifest.services?.provides ?? [],
        [...module.requiredDependencies, ...module.optionalDependencies].map((dependency) => dependency.id),
      )
    : undefined;
  const sdk: RuntimeModuleHostSdk = module.manifest.sdkVersion === 3
    ? { ...nativeApis, sdkVersion: 3 }
    : module.manifest.sdkVersion === 4
      ? { ...nativeApis, sdkVersion: 4, services: services! }
      : {
          ...nativeApis,
          sdkVersion: 5,
          services: services!,
          moduleRepository: {
            async chooseDirectory() {
              const path = await repositoryDirectoryPicker();
              return path === null ? null : nativeBackend.createModuleRepositoryGrant(token, path);
            },
            scan: (grantId) => nativeBackend.scanModuleRepository(token, grantId),
            install: (grantId, fileName) => nativeBackend.installModuleFromRepository(token, grantId, fileName),
          },
        };
  nativeSessions.set(sdk, {
    backend: nativeBackend,
    token,
    cleanups,
    releaseServices: sdk.sdkVersion >= 4 ? () => serviceBus.releaseModule(moduleId) : undefined,
  });
  return sdk;
}

export async function releaseRuntimeModuleHostSdk(sdk: RuntimeModuleHostSdk | undefined) {
  if (!sdk) return;
  const session = nativeSessions.get(sdk);
  if (!session) return;
  nativeSessions.delete(sdk);
  session.releaseServices?.();
  session.cleanups.forEach((cleanup) => cleanup());
  session.cleanups.clear();
  await session.backend.releaseSession(session.token);
}
