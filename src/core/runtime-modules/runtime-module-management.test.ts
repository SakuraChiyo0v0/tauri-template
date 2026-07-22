import { describe, expect, it } from "vitest";
import type { RegisteredFeature } from "@/core/features/feature-types";
import { getModuleManagementState } from "./runtime-module-management";

function feature(overrides: Partial<RegisteredFeature> = {}): RegisteredFeature {
  return {
    id: "hello-module",
    name: "Hello",
    description: "Hello module",
    version: "1.0.0",
    defaultEnabled: true,
    source: "runtime",
    runtime: {
      manifest: {
        schemaVersion: 1,
        id: "hello-module",
        name: "Hello",
        description: "Hello module",
        version: "1.0.0",
        hostVersion: "^0.1.0",
        sdkVersion: 1,
        entry: "index.js",
        navigation: [],
        settings: [],
      },
      activeVersion: "1.0.0",
      previousVersion: null,
      availableVersions: ["1.0.0"],
      activeSha256: "abc",
      blockedVersion: null,
      lastError: null,
    },
    ...overrides,
  };
}

describe("module management state", () => {
  it("keeps destructive package actions unavailable for builtin modules", () => {
    const state = getModuleManagementState(feature({ source: "builtin", runtime: undefined }), true);

    expect(state).toMatchObject({ sourceLabel: "内置", canRollback: false, canUninstall: false });
  });

  it("enables rollback only when a runtime module has a previous version", () => {
    const withoutPrevious = getModuleManagementState(feature(), true);
    const withPrevious = getModuleManagementState(feature({
      runtime: { ...feature().runtime!, previousVersion: "0.9.0" },
    }), true);

    expect(withoutPrevious.canRollback).toBe(false);
    expect(withPrevious).toMatchObject({ sourceLabel: "运行时", canRollback: true, canUninstall: true });
  });

  it("shows a blocked active version as failed and prevents a fake enable action", () => {
    const module = feature();
    const state = getModuleManagementState(feature({
      runtime: {
        ...module.runtime!,
        blockedVersion: "1.0.0",
        lastError: { version: "1.0.0", message: "activate failed", occurredAt: "now" },
      },
    }), true);

    expect(state).toMatchObject({ status: "failed", canToggle: false, error: "activate failed" });
  });
});
