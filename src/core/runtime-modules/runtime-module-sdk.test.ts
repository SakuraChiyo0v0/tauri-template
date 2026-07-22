import { describe, expect, it, vi } from "vitest";
import { clearLogEntries, getLogSnapshot } from "@/features/logging/log-store";
import { decodeModuleLogRecord } from "@/features/logging/logger";
import { setColorMode } from "@/themes/theme-store";
import { setLocale } from "@/core/i18n/locale-store";
import { createRuntimeModuleHostSdk, releaseRuntimeModuleHostSdk } from "./runtime-module-sdk";
import { createRuntimeModuleServiceBus } from "./runtime-module-services";
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
});
