import packageMetadata from "../../../package.json";
import { open, save } from "@tauri-apps/plugin-dialog";
import { createModuleLogger } from "@/features/logging/logger";
import { getSetting, setSetting, subscribeSettings, getSettingsSnapshot } from "@/core/settings/setting-store";
import { getThemeSnapshot, subscribeTheme } from "@/themes/theme-store";
import { getLocaleSnapshot, subscribeLocale } from "@/core/i18n/locale-store";
import { runtimeModuleDatabaseApi } from "./runtime-module-database-api";
import { runtimeModuleNativeApi } from "./runtime-module-native-api";
import { runtimeModuleServiceBus, type RuntimeModuleServiceBus } from "./runtime-module-services";
import { runtimeModuleEventBus, type RuntimeModuleEventBus } from "./runtime-module-events";
import { runtimeModuleDialogBus, type RuntimeModuleDialogBus } from "./runtime-module-dialogs";
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
  releaseEvents?: () => void;
  releaseDialogs?: () => void;
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

function dataApi(token: string, moduleId: string, backend: RuntimeModuleNativeBackend) {
  return {
    async exportBackup() {
      const targetPath = await save({
        defaultPath: `${moduleId}-backup.mtbk`,
        filters: [{ name: "Module Backup", extensions: ["mtbk"] }],
      });
      if (typeof targetPath !== "string" || targetPath.length === 0) return null;
      const settingsJson = JSON.stringify(getSettingsSnapshot()[moduleId] ?? {});
      const result = await backend.exportModuleBackup(token, settingsJson, targetPath);
      return {
        grantId: `${moduleId}:${result.fileName}:${result.size}`,
        displayName: result.fileName,
        size: result.size,
      };
    },
    async importBackup(grantId: string) {
      const sourcePath = await open({
        multiple: false,
        filters: [{ name: "Module Backup", extensions: ["mtbk"] }],
      });
      if (typeof sourcePath !== "string" || sourcePath.length === 0) return;
      if (!grantId.startsWith(`${moduleId}:`)) {
        throw new Error("Backup grant does not belong to this module.");
      }
      const result = await backend.importModuleBackup(token, sourcePath);
      try {
        const parsed = JSON.parse(result.settingsJson || "{}") as Record<string, unknown>;
        for (const [settingId, value] of Object.entries(parsed)) {
          setSetting(moduleId, settingId, value);
        }
      } catch {
        // settings restore is best-effort; database is the source of truth
      }
    },
  };
}

export async function createRuntimeModuleHostSdk(
  module: InstalledRuntimeModule,
  databaseBackend: RuntimeModuleDatabaseBackend = runtimeModuleDatabaseApi,
  nativeBackend: RuntimeModuleNativeBackend = runtimeModuleNativeApi,
  serviceBus: RuntimeModuleServiceBus = runtimeModuleServiceBus,
  repositoryDirectoryPicker: RuntimeModuleRepositoryDirectoryPicker = defaultRepositoryDirectoryPicker,
  eventBus: RuntimeModuleEventBus = runtimeModuleEventBus,
  dialogBus: RuntimeModuleDialogBus = runtimeModuleDialogBus,
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
  const events = module.manifest.sdkVersion >= 7
    ? eventBus.createModuleApi(
        moduleId,
        module.manifest.events?.publishes ?? [],
        module.manifest.events?.subscribes ?? [],
      )
    : undefined;
  const repositoryApi = {
    async chooseDirectory() {
      const path = await repositoryDirectoryPicker();
      return path === null ? null : nativeBackend.createModuleRepositoryGrant(token, path);
    },
    scan: (grantId: string) => nativeBackend.scanModuleRepository(token, grantId),
    install: (grantId: string, fileName: string) => nativeBackend.installModuleFromRepository(token, grantId, fileName),
    previewInstallPlan: (grantId: string, fileName: string) => nativeBackend.previewModuleRepositoryInstall(token, grantId, fileName),
    executeInstallPlan: (grantId: string, planId: string) => nativeBackend.executeModuleRepositoryInstallPlan(token, grantId, planId),
  };
  const sdk: RuntimeModuleHostSdk = module.manifest.sdkVersion === 3
    ? { ...nativeApis, sdkVersion: 3 }
    : module.manifest.sdkVersion === 4
      ? { ...nativeApis, sdkVersion: 4, services: services! }
      : module.manifest.sdkVersion === 5
        ? {
          ...nativeApis,
          sdkVersion: 5,
          services: services!,
          moduleRepository: {
            chooseDirectory: repositoryApi.chooseDirectory,
            scan: repositoryApi.scan,
            install: repositoryApi.install,
          },
        }
        : module.manifest.sdkVersion === 6
          ? {
            ...nativeApis,
            sdkVersion: 6,
            services: services!,
            moduleRepository: repositoryApi,
          }
          : module.manifest.sdkVersion === 7
            ? {
              ...nativeApis,
              sdkVersion: 7,
              services: services!,
              moduleRepository: repositoryApi,
              events: events!,
            }
            : module.manifest.sdkVersion === 8
              ? {
                ...nativeApis,
                sdkVersion: 8,
                services: services!,
                moduleRepository: repositoryApi,
                events: events!,
                notifications: {
                  show: (notification) => nativeBackend.showNotification(token, notification),
                },
              }
              : module.manifest.sdkVersion === 9
                ? {
                    ...nativeApis,
                    sdkVersion: 9,
                    services: services!,
                    moduleRepository: repositoryApi,
                    events: events!,
                    notifications: {
                      show: (notification) => nativeBackend.showNotification(token, notification),
                    },
                    data: dataApi(token, moduleId, nativeBackend),
                  }
                : module.manifest.sdkVersion === 10
                  ? {
                      ...nativeApis,
                      sdkVersion: 10,
                      services: services!,
                      moduleRepository: repositoryApi,
                      events: events!,
                      notifications: {
                        show: (notification) => nativeBackend.showNotification(token, notification),
                      },
                      data: dataApi(token, moduleId, nativeBackend),
                      clipboard: {
                        readText: () => nativeBackend.readClipboard(token),
                        writeText: (text) => nativeBackend.writeClipboard(token, text),
                      },
                    }
                  : module.manifest.sdkVersion === 11
                    ? {
                        ...nativeApis,
                        sdkVersion: 11,
                        services: services!,
                        moduleRepository: repositoryApi,
                        events: events!,
                        notifications: {
                          show: (notification) => nativeBackend.showNotification(token, notification),
                        },
                        data: dataApi(token, moduleId, nativeBackend),
                        clipboard: {
                          readText: () => nativeBackend.readClipboard(token),
                          writeText: (text) => nativeBackend.writeClipboard(token, text),
                        },
                        dialogs: dialogBus.createModuleApi(moduleId),
                      }
                    : {
                        ...nativeApis,
                        sdkVersion: 12,
                        services: services!,
                        moduleRepository: repositoryApi,
                        events: events!,
                        notifications: {
                          show: (notification) => nativeBackend.showNotification(token, notification),
                        },
                        data: dataApi(token, moduleId, nativeBackend),
                        clipboard: {
                          readText: () => nativeBackend.readClipboard(token),
                          writeText: (text) => nativeBackend.writeClipboard(token, text),
                        },
                        dialogs: dialogBus.createModuleApi(moduleId),
                        http: {
                          fetch: async (options) => {
                            const result = await nativeBackend.fetchHttp(token, options);
                            if (result.error) throw new Error(result.error);
                            return result.response!;
                          },
                        },
                      };
  nativeSessions.set(sdk, {
    backend: nativeBackend,
    token,
    cleanups,
    releaseServices: sdk.sdkVersion >= 4 ? () => serviceBus.releaseModule(moduleId) : undefined,
    releaseEvents: sdk.sdkVersion >= 7 ? () => eventBus.releaseModule(moduleId) : undefined,
    releaseDialogs: sdk.sdkVersion >= 11 ? () => dialogBus.releaseModule(moduleId) : undefined,
  });
  return sdk;
}

export async function releaseRuntimeModuleHostSdk(sdk: RuntimeModuleHostSdk | undefined) {
  if (!sdk) return;
  const session = nativeSessions.get(sdk);
  if (!session) return;
  nativeSessions.delete(sdk);
  session.releaseServices?.();
  session.releaseEvents?.();
  session.releaseDialogs?.();
  session.cleanups.forEach((cleanup) => cleanup());
  session.cleanups.clear();
  await session.backend.releaseSession(session.token);
}
