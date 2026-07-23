import { describe, expect, it, vi } from "vitest";
import { clearLogEntries, getLogSnapshot } from "@/features/logging/log-store";
import { decodeModuleLogRecord } from "@/features/logging/logger";
import { setColorMode } from "@/themes/theme-store";
import { setLocale } from "@/core/i18n/locale-store";
import { createRuntimeModuleHostSdk, releaseRuntimeModuleHostSdk } from "./runtime-module-sdk";
import { createRuntimeModuleServiceBus } from "./runtime-module-services";
import { createRuntimeModuleEventBus } from "./runtime-module-events";
import { createRuntimeModuleDialogBus } from "./runtime-module-dialogs";
import type {
  InstalledRuntimeModule,
  RuntimeModuleDatabaseBackend,
  RuntimeModuleNativeBackend,
  RuntimeSqlValue,
} from "./runtime-module-types";

function moduleRecord(): InstalledRuntimeModule {
  return {
    manifest: {
      schemaVersion: 2,
      id: "sdk-test-module",
      name: { "zh-CN": "SDK 测试", en: "SDK test" },
      description: { "zh-CN": "SDK 测试模块", en: "SDK test module" },
      version: "2.1.0",
      hostVersion: "^0.1.0",
      sdkVersion: 2,
      entry: "index.js",
      dependencies: { required: [], optional: [] },
      navigation: [],
      settings: [],
    },
    desiredEnabled: true,
    selectedVersion: "2.1.0",
    previousSelectedVersion: null,
    selectedSha256: "abc",
    status: "active",
    diagnostics: [],
    requiredDependencies: [],
    optionalDependencies: [],
    dependents: [],
    activeVersion: "2.1.0",
    previousVersion: null,
    availableVersions: ["2.1.0"],
    activeSha256: "abc",
    blockedVersion: null,
    lastError: null,
    permissionStatus: "not_required",
    permissionVersion: null,
    nativePermissionSummary: [],
    nativePermissionFingerprint: null,
  };
}

describe("runtime module host SDK", () => {
  it("provides namespaced database operations to Host SDK V2", async () => {
    const module = moduleRecord();
    const select = vi.fn();
    const database: RuntimeModuleDatabaseBackend = {
      execute: vi.fn(async () => ({ rowsAffected: 1, lastInsertId: 7 })),
      select: async <T extends Record<string, RuntimeSqlValue>>(moduleId: string, sql: string, params: RuntimeSqlValue[]) => {
        select(moduleId, sql, params);
        return [] as T[];
      },
      transaction: vi.fn(async () => [{ rowsAffected: 1, lastInsertId: 7 }]),
      getUserVersion: vi.fn(async () => 0),
      setUserVersion: vi.fn(async () => undefined),
    };

    const sdk = await createRuntimeModuleHostSdk(module, database);
    if (sdk.sdkVersion !== 2) throw new Error("expected Host SDK V2");
    await sdk.database.execute("INSERT INTO notes(title) VALUES (?1)", ["hello"]);
    await sdk.database.select("SELECT title FROM notes");

    expect(database.execute).toHaveBeenCalledWith("sdk-test-module", "INSERT INTO notes(title) VALUES (?1)", ["hello"]);
    expect(select).toHaveBeenCalledWith("sdk-test-module", "SELECT title FROM notes", []);
  });

  it("creates a version-bound session and exposes database plus native APIs to Host SDK V3", async () => {
    const module = moduleRecord();
    module.manifest = {
      ...module.manifest,
      sdkVersion: 3,
      nativeCapabilities: {
        filesystem: { private: true, external: [] },
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
      },
    };
    const native: RuntimeModuleNativeBackend = {
      createSession: vi.fn(async () => "native-session-token"),
      readPrivateFile: vi.fn(async () => [1, 2, 3]),
      openPath: vi.fn(async () => undefined),
      revealInFolder: vi.fn(async () => undefined),
    } as unknown as RuntimeModuleNativeBackend;

    const sdk = await createRuntimeModuleHostSdk(module, undefined, native);
    if (sdk.sdkVersion !== 3) throw new Error("expected Host SDK V3");
    await sdk.filesystem.readPrivate("notes/data.bin");
    await sdk.process.openPath("selected-file");
    await sdk.process.revealInFolder("selected-file");

    expect(native.createSession).toHaveBeenCalledWith("sdk-test-module", "2.1.0");
    expect(native.readPrivateFile).toHaveBeenCalledWith("native-session-token", "notes/data.bin");
    expect(native.openPath).toHaveBeenCalledWith("native-session-token", "selected-file");
    expect(native.revealInFolder).toHaveBeenCalledWith("native-session-token", "selected-file");
    expect(sdk).toHaveProperty("database");
  });

  it("exposes dependency-scoped services to Host SDK V4 and releases registrations", async () => {
    const provider = moduleRecord();
    provider.manifest = {
      ...provider.manifest,
      id: "local-notes",
      sdkVersion: 4,
      services: { provides: ["notes.v1"] },
    };
    const consumer = moduleRecord();
    consumer.manifest = {
      ...consumer.manifest,
      id: "notes-dashboard",
      sdkVersion: 4,
      dependencies: { required: [{ id: "local-notes", version: "^2.0.0" }], optional: [] },
    };
    consumer.requiredDependencies = [{ id: "local-notes", version: "^2.0.0" }];
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
      releaseSession: vi.fn(async () => undefined),
    } as unknown as RuntimeModuleNativeBackend;
    const bus = createRuntimeModuleServiceBus();
    const providerSdk = await createRuntimeModuleHostSdk(provider, undefined, native, bus);
    const consumerSdk = await createRuntimeModuleHostSdk(consumer, undefined, native, bus);
    if (providerSdk.sdkVersion !== 4 || consumerSdk.sdkVersion !== 4) throw new Error("expected Host SDK V4");

    providerSdk.services.expose("notes.v1", { stats: () => ({ count: 2 }) });
    await expect(consumerSdk.services.call("local-notes", "notes.v1", "stats", null))
      .resolves.toEqual({ count: 2 });

    await releaseRuntimeModuleHostSdk(providerSdk);
    expect(consumerSdk.services.available("local-notes", "notes.v1")).toBe(false);
    await releaseRuntimeModuleHostSdk(consumerSdk);
    expect(native.releaseSession).toHaveBeenCalledTimes(2);
  });

  it("exposes repository APIs only to Host SDK V5 and binds opaque values to the native session", async () => {
    const module = moduleRecord();
    module.manifest = {
      ...module.manifest,
      sdkVersion: 5,
      services: { provides: [] },
      nativeCapabilities: {
        filesystem: { private: false, external: ["read", "list"] },
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        moduleRepository: { install: true },
      },
    };
    const grant = {
      id: "repository-grant",
      moduleId: "sdk-test-module",
      displayName: "module-market",
      kind: "directory" as const,
      access: { read: true, write: false, list: true, execute: false },
    };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
      createModuleRepositoryGrant: vi.fn(async () => grant),
      scanModuleRepository: vi.fn(async () => []),
      installModuleFromRepository: vi.fn(async () => ({
        moduleId: "local-notes",
        version: "0.1.1",
        selectedVersion: "0.1.1",
        status: "active" as const,
        packageInstalled: true,
        planChanged: true,
      })),
    } as unknown as RuntimeModuleNativeBackend;

    const sdk = await createRuntimeModuleHostSdk(
      module,
      undefined,
      native,
      createRuntimeModuleServiceBus(),
      async () => "C:/opaque-to-module/repository",
    );
    if (sdk.sdkVersion !== 5) throw new Error("expected Host SDK V5");

    await expect(sdk.moduleRepository.chooseDirectory()).resolves.toEqual(grant);
    await sdk.moduleRepository.scan("repository-grant");
    await sdk.moduleRepository.install("repository-grant", "local-notes-0.1.1.mtp");

    expect(native.createModuleRepositoryGrant).toHaveBeenCalledWith("native-session-token", "C:/opaque-to-module/repository");
    expect(native.scanModuleRepository).toHaveBeenCalledWith("native-session-token", "repository-grant");
    expect(native.installModuleFromRepository).toHaveBeenCalledWith("native-session-token", "repository-grant", "local-notes-0.1.1.mtp");
  });

  it("does not inject repository APIs into Host SDK V4", async () => {
    const module = moduleRecord();
    module.manifest = { ...module.manifest, sdkVersion: 4, services: { provides: [] } };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());

    expect(sdk.sdkVersion).toBe(4);
    expect(sdk).not.toHaveProperty("moduleRepository");
  });

  it("adds dependency plan APIs only to Host SDK V6 and binds plans to the native session", async () => {
    const module = moduleRecord();
    module.manifest = {
      ...module.manifest,
      sdkVersion: 6,
      services: { provides: [] },
      nativeCapabilities: {
        filesystem: { private: false, external: ["read", "list"] },
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        moduleRepository: { install: true },
      },
    };
    const plan = {
      planId: "opaque-plan",
      targetModuleId: "notes-dashboard",
      targetVersion: "1.0.0",
      executable: true,
      entries: [],
      activationOrder: [],
      diagnostics: [],
    };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
      previewModuleRepositoryInstall: vi.fn(async () => plan),
      executeModuleRepositoryInstallPlan: vi.fn(async () => ({
        targetModuleId: "notes-dashboard",
        planChanged: true,
        modules: [],
      })),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());
    if (sdk.sdkVersion !== 6) throw new Error("expected Host SDK V6");

    await expect(sdk.moduleRepository.previewInstallPlan("repository-grant", "dashboard.mtp")).resolves.toEqual(plan);
    await sdk.moduleRepository.executeInstallPlan("repository-grant", "opaque-plan");

    expect(native.previewModuleRepositoryInstall).toHaveBeenCalledWith("native-session-token", "repository-grant", "dashboard.mtp");
    expect(native.executeModuleRepositoryInstallPlan).toHaveBeenCalledWith("native-session-token", "repository-grant", "opaque-plan");
  });

  it("namespaces settings to the active module", async () => {
    const sdk = await createRuntimeModuleHostSdk(moduleRecord());

    sdk.settings.set("greeting", "hello");

    expect(sdk.settings.get("greeting", "fallback")).toBe("hello");
    expect(JSON.parse(localStorage.getItem("modular-tauri.settings.v1") ?? "{}")).toEqual({
      "sdk-test-module": { greeting: "hello" },
    });
  });

  it("delivers theme changes to subscribers", async () => {
    const sdk = await createRuntimeModuleHostSdk(moduleRecord());
    const listener = vi.fn();
    const unsubscribe = sdk.theme.subscribe(listener);

    setColorMode("dark");

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ mode: "dark" }));
    unsubscribe();
  });

  it("exposes and publishes application language changes", async () => {
    const sdk = await createRuntimeModuleHostSdk(moduleRecord());
    const listener = vi.fn();
    const unsubscribe = sdk.i18n.subscribe(listener);

    expect(sdk.i18n.getLocale()).toBe("zh-CN");
    setLocale("en");

    expect(sdk.i18n.getLocale()).toBe("en");
    expect(listener).toHaveBeenCalledWith("en");
    unsubscribe();
  });

  it("writes module logs using the module id as source", async () => {
    clearLogEntries();
    const sdk = await createRuntimeModuleHostSdk(moduleRecord());

    await sdk.logger.info("hello from module");

    expect(getLogSnapshot()[0]).toMatchObject({
      level: "info",
      source: "sdk-test-module",
      message: "hello from module",
    });
  });

  it("recovers module identity from a formatted native bridge record", () => {
    const encoded = "[host][INFO] \u2063mtp:{\"source\":\"sdk-test-module\",\"message\":\"hello\"}";

    expect(decodeModuleLogRecord(encoded)).toEqual({ source: "sdk-test-module", message: "hello" });
  });

  it("exposes event APIs only to Host SDK V7 and unsubscribes on release", async () => {
    const publisher = moduleRecord();
    publisher.manifest = {
      ...publisher.manifest,
      id: "local-notes",
      sdkVersion: 7,
      services: { provides: [] },
      events: { publishes: ["notes.changed.v1"], subscribes: [] },
    };
    const subscriber = moduleRecord();
    subscriber.manifest = {
      ...subscriber.manifest,
      id: "notes-dashboard",
      sdkVersion: 7,
      services: { provides: [] },
      events: { publishes: [], subscribes: ["notes.changed.v1"] },
    };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
      releaseSession: vi.fn(async () => undefined),
    } as unknown as RuntimeModuleNativeBackend;
    const bus = createRuntimeModuleServiceBus();
    const eventBus = createRuntimeModuleEventBus({ onError: vi.fn() });
    const publisherSdk = await createRuntimeModuleHostSdk(publisher, undefined, native, bus, undefined, eventBus);
    const subscriberSdk = await createRuntimeModuleHostSdk(subscriber, undefined, native, bus, undefined, eventBus);
    if (publisherSdk.sdkVersion !== 7 || subscriberSdk.sdkVersion !== 7) throw new Error("expected Host SDK V7");

    const listener = vi.fn();
    subscriberSdk.events.subscribe("notes.changed.v1", listener);
    publisherSdk.events.publish("notes.changed.v1", { change: "created", noteId: 3 });
    await eventBus.whenIdle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      eventId: "notes.changed.v1",
      publisherModuleId: "local-notes",
      payload: { change: "created", noteId: 3 },
    });

    await releaseRuntimeModuleHostSdk(subscriberSdk);
    publisherSdk.events.publish("notes.changed.v1", { change: "updated" });
    await eventBus.whenIdle();
    expect(listener).toHaveBeenCalledTimes(1);
    await releaseRuntimeModuleHostSdk(publisherSdk);
    expect(() => publisherSdk.events.publish("notes.changed.v1", null)).toThrow(/released/i);
  });

  it("does not inject event APIs into Host SDK V6", async () => {
    const module = moduleRecord();
    module.manifest = { ...module.manifest, sdkVersion: 6, services: { provides: [] } };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());

    expect(sdk.sdkVersion).toBe(6);
    expect(sdk).not.toHaveProperty("events");
  });

  it("exposes notifications only to Host SDK V8 and routes show through the native session", async () => {
    const module = moduleRecord();
    module.manifest = {
      ...module.manifest,
      id: "notifier-module",
      sdkVersion: 8,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: {
        filesystem: null,
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        notifications: { system: true },
      },
    };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
      releaseSession: vi.fn(async () => undefined),
      showNotification: vi.fn(async () => undefined),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());
    if (sdk.sdkVersion !== 8) throw new Error("expected Host SDK V8");

    await sdk.notifications.show({ title: "完成", body: "同步结束" });

    expect(native.showNotification).toHaveBeenCalledWith("native-session-token", { title: "完成", body: "同步结束" });
    await releaseRuntimeModuleHostSdk(sdk);
    expect(native.releaseSession).toHaveBeenCalledTimes(1);
  });

  it("does not inject notifications into Host SDK V7", async () => {
    const module = moduleRecord();
    module.manifest = { ...module.manifest, sdkVersion: 7, services: { provides: [] } };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());

    expect(sdk.sdkVersion).toBe(7);
    expect(sdk).not.toHaveProperty("notifications");
  });

  it("exposes data portability only to Host SDK V9", async () => {
    const module = moduleRecord();
    module.manifest = {
      ...module.manifest,
      id: "local-notes",
      sdkVersion: 9,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: {
        filesystem: null,
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        notifications: { system: true },
      },
    };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
      releaseSession: vi.fn(async () => undefined),
      exportModuleBackup: vi.fn(async (_token: string, settingsJson: string, _targetPath: string) => ({
        moduleId: "local-notes",
        fileName: "local-notes-backup.mtbk",
        size: settingsJson.length + 100,
      })),
      importModuleBackup: vi.fn(async () => ({
        moduleId: "local-notes",
        settingsJson: "{}",
        databaseSize: 0,
      })),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());
    if (sdk.sdkVersion !== 9) throw new Error("expected Host SDK V9");

    expect(sdk).toHaveProperty("data");
    expect(typeof sdk.data.exportBackup).toBe("function");
    expect(typeof sdk.data.importBackup).toBe("function");
    await releaseRuntimeModuleHostSdk(sdk);
  });

  it("does not inject data portability into Host SDK V8", async () => {
    const module = moduleRecord();
    module.manifest = { ...module.manifest, sdkVersion: 8, services: { provides: [] } };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());

    expect(sdk.sdkVersion).toBe(8);
    expect(sdk).not.toHaveProperty("data");
  });

  it("exposes clipboard only to Host SDK V10 and routes through the native session", async () => {
    const module = moduleRecord();
    module.manifest = {
      ...module.manifest,
      id: "clipper-module",
      sdkVersion: 10,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: {
        filesystem: null,
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        notifications: { system: true },
        clipboard: { text: true },
      },
    };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
      releaseSession: vi.fn(async () => undefined),
      readClipboard: vi.fn(async () => "copied-text"),
      writeClipboard: vi.fn(async () => undefined),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());
    if (sdk.sdkVersion !== 10) throw new Error("expected Host SDK V10");

    expect(sdk).toHaveProperty("clipboard");
    await sdk.clipboard.writeText("hello");
    expect(native.writeClipboard).toHaveBeenCalledWith("native-session-token", "hello");
    await expect(sdk.clipboard.readText()).resolves.toBe("copied-text");
    expect(native.readClipboard).toHaveBeenCalledWith("native-session-token");
    await releaseRuntimeModuleHostSdk(sdk);
  });

  it("does not inject clipboard into Host SDK V9", async () => {
    const module = moduleRecord();
    module.manifest = { ...module.manifest, sdkVersion: 9, services: { provides: [] } };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());

    expect(sdk.sdkVersion).toBe(9);
    expect(sdk).not.toHaveProperty("clipboard");
  });

  it("exposes dialogs only to Host SDK V11 and routes confirm/prompt through the dialog bus", async () => {
    const module = moduleRecord();
    module.manifest = {
      ...module.manifest,
      id: "dialog-module",
      sdkVersion: 11,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: {
        filesystem: null,
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        notifications: { system: true },
        clipboard: { text: true },
      },
    };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
      releaseSession: vi.fn(async () => undefined),
    } as unknown as RuntimeModuleNativeBackend;
    const dialogBus = createRuntimeModuleDialogBus();
    dialogBus.setRenderer((request) => queueMicrotask(() => {
      if (request.kind === "confirm") request.resolve(true);
      else request.resolve("answer");
    }));
    const sdk = await createRuntimeModuleHostSdk(
      module, undefined, native, createRuntimeModuleServiceBus(), undefined, undefined, dialogBus,
    );
    if (sdk.sdkVersion !== 11) throw new Error("expected Host SDK V11");

    expect(sdk).toHaveProperty("dialogs");
    expect(await sdk.dialogs.confirm({ title: "ok" })).toBe(true);
    expect(await sdk.dialogs.prompt({ title: "name" })).toBe("answer");
    await releaseRuntimeModuleHostSdk(sdk);
  });

  it("does not inject dialogs into Host SDK V10", async () => {
    const module = moduleRecord();
    module.manifest = { ...module.manifest, sdkVersion: 10, services: { provides: [] } };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());

    expect(sdk.sdkVersion).toBe(10);
    expect(sdk).not.toHaveProperty("dialogs");
  });

  it("exposes http only to Host SDK V12 and routes fetch through the native backend", async () => {
    const module = moduleRecord();
    module.manifest = {
      ...module.manifest,
      id: "http-module",
      sdkVersion: 12,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: {
        filesystem: null,
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        notifications: { system: true },
        clipboard: { text: true },
        http: { origins: ["https://api.example.com"] },
      },
    };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
      releaseSession: vi.fn(async () => undefined),
      fetchHttp: vi.fn(async () => ({
        moduleId: "http-module",
        response: { status: 200, headers: [["content-type", "application/json"]], body: [123], truncated: false },
        error: null,
      })),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());
    if (sdk.sdkVersion !== 12) throw new Error("expected Host SDK V12");

    const response = await sdk.http.fetch({ url: "https://api.example.com/v1" });
    expect(response.status).toBe(200);
    expect(native.fetchHttp).toHaveBeenCalledWith("native-session-token", expect.objectContaining({ url: "https://api.example.com/v1" }));
    await releaseRuntimeModuleHostSdk(sdk);
  });

  it("does not inject http into Host SDK V11", async () => {
    const module = moduleRecord();
    module.manifest = { ...module.manifest, sdkVersion: 11, services: { provides: [] } };
    const native = {
      createSession: vi.fn(async () => "native-session-token"),
    } as unknown as RuntimeModuleNativeBackend;
    const sdk = await createRuntimeModuleHostSdk(module, undefined, native, createRuntimeModuleServiceBus());

    expect(sdk.sdkVersion).toBe(11);
    expect(sdk).not.toHaveProperty("http");
  });
});
