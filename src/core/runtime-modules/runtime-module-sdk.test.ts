import { describe, expect, it, vi } from "vitest";
import { clearLogEntries, getLogSnapshot } from "@/features/logging/log-store";
import { decodeModuleLogRecord } from "@/features/logging/logger";
import { setColorMode } from "@/themes/theme-store";
import { createRuntimeModuleHostSdk } from "./runtime-module-sdk";
import type { InstalledRuntimeModule, RuntimeModuleDatabaseBackend, RuntimeSqlValue } from "./runtime-module-types";

function moduleRecord(): InstalledRuntimeModule {
  return {
    manifest: {
      schemaVersion: 1,
      id: "sdk-test-module",
      name: "SDK test",
      description: "SDK test module",
      version: "2.1.0",
      hostVersion: "^0.1.0",
      sdkVersion: 1,
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
  };
}

describe("runtime module host SDK", () => {
  it("keeps database capability absent from Host SDK V1", () => {
    expect(createRuntimeModuleHostSdk(moduleRecord())).not.toHaveProperty("database");
  });

  it("provides namespaced database operations to Host SDK V2", async () => {
    const module = moduleRecord();
    module.manifest.sdkVersion = 2;
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

    const sdk = createRuntimeModuleHostSdk(module, database);
    if (sdk.sdkVersion !== 2) throw new Error("expected Host SDK V2");
    await sdk.database.execute("INSERT INTO notes(title) VALUES (?1)", ["hello"]);
    await sdk.database.select("SELECT title FROM notes");

    expect(database.execute).toHaveBeenCalledWith("sdk-test-module", "INSERT INTO notes(title) VALUES (?1)", ["hello"]);
    expect(select).toHaveBeenCalledWith("sdk-test-module", "SELECT title FROM notes", []);
  });

  it("namespaces settings to the active module", () => {
    const sdk = createRuntimeModuleHostSdk(moduleRecord());

    sdk.settings.set("greeting", "hello");

    expect(sdk.settings.get("greeting", "fallback")).toBe("hello");
    expect(JSON.parse(localStorage.getItem("modular-tauri.settings.v1") ?? "{}")).toEqual({
      "sdk-test-module": { greeting: "hello" },
    });
  });

  it("delivers theme changes to subscribers", () => {
    const sdk = createRuntimeModuleHostSdk(moduleRecord());
    const listener = vi.fn();
    const unsubscribe = sdk.theme.subscribe(listener);

    setColorMode("dark");

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ mode: "dark" }));
    unsubscribe();
  });

  it("writes module logs using the module id as source", async () => {
    clearLogEntries();
    const sdk = createRuntimeModuleHostSdk(moduleRecord());

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
