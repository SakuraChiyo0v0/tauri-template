import { describe, expect, it, vi } from "vitest";
import { clearLogEntries, getLogSnapshot } from "@/features/logging/log-store";
import { decodeModuleLogRecord } from "@/features/logging/logger";
import { setColorMode } from "@/themes/theme-store";
import { createRuntimeModuleHostSdk } from "./runtime-module-sdk";
import type { InstalledRuntimeModule } from "./runtime-module-types";

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
