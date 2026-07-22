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
        dependencies: { required: [], optional: [] },
        navigation: [],
        settings: [],
      },
      desiredEnabled: true,
      selectedVersion: "1.0.0",
      previousSelectedVersion: null,
      selectedSha256: "abc",
      status: "active",
      diagnostics: [],
      requiredDependencies: [],
      optionalDependencies: [],
      dependents: [],
      activeVersion: "1.0.0",
      previousVersion: null,
      availableVersions: ["1.0.0"],
      activeSha256: "abc",
      blockedVersion: null,
      lastError: null,
      permissionStatus: "not_required",
      permissionVersion: null,
      nativePermissionSummary: [],
      nativePermissionFingerprint: null,
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
      runtime: { ...feature().runtime!, previousSelectedVersion: "0.9.0", previousVersion: "0.9.0" },
    }), true);

    expect(withoutPrevious.canRollback).toBe(false);
    expect(withPrevious).toMatchObject({ sourceLabel: "运行时", canRollback: true, canUninstall: true });
  });

  it("shows an activation failure as blocked while allowing the user to disable it", () => {
    const module = feature();
    const state = getModuleManagementState(feature({
      runtime: {
        ...module.runtime!,
        selectedVersion: null,
        selectedSha256: null,
        status: "blocked",
        blockedVersion: "1.0.0",
        lastError: { version: "1.0.0", message: "activate failed", occurredAt: "now" },
      },
    }), true);

    expect(state).toMatchObject({ status: "blocked", statusLabel: "激活受阻", canToggle: true, error: "activate failed" });
  });

  it("explains missing, incompatible, and cyclic dependencies without parsing free text", () => {
    const base = feature().runtime!;
    const state = getModuleManagementState(feature({
      runtime: {
        ...base,
        selectedVersion: null,
        selectedSha256: null,
        status: "waiting",
        diagnostics: [
          { code: "missing_dependency", moduleId: "hello-module", dependencyId: "data-provider", requiredVersion: "^1.0.0", availableVersions: [], relatedModules: [] },
          { code: "incompatible_dependency", moduleId: "hello-module", dependencyId: "export-tools", requiredVersion: "^2.0.0", availableVersions: ["1.0.0"], relatedModules: [] },
          { code: "dependency_cycle", moduleId: "hello-module", dependencyId: null, requiredVersion: null, availableVersions: [], relatedModules: ["hello-module", "data-provider", "hello-module"] },
        ],
      },
    }), false);

    expect(state).toMatchObject({ status: "waiting", statusLabel: "等待依赖", toggleChecked: true });
    expect(state.diagnosticMessages).toEqual([
      "缺少 data-provider（需要 ^1.0.0）",
      "export-tools 版本不兼容：需要 ^2.0.0，本机有 1.0.0",
      "依赖循环：hello-module → data-provider → hello-module",
    ]);
  });

  it("keeps direct dependents available to dependency-aware actions", () => {
    const module = feature();
    const state = getModuleManagementState(feature({
      runtime: {
        ...module.runtime!,
        requiredDependencies: [{ id: "data-provider", version: "^1.0.0" }],
        dependents: ["report-consumer"],
      },
    }), true);

    expect(state).toMatchObject({
      canToggle: true,
      canUninstall: true,
      requiredDependencies: ["data-provider ^1.0.0"],
      dependents: ["report-consumer"],
    });
  });

  it("shows a reviewable permission summary and the correct approval action", () => {
    const module = feature();
    const state = getModuleManagementState(feature({
      runtime: {
        ...module.runtime!,
        selectedVersion: null,
        status: "waiting",
        permissionStatus: "awaiting_approval",
        permissionVersion: "2.0.0",
        nativePermissionSummary: ["模块私有文件", "打开 URL: https"],
        nativePermissionFingerprint: "permission-fingerprint",
      },
    }), false);

    expect(state).toMatchObject({
      statusLabel: "等待权限",
      permissionSummary: ["模块私有文件", "打开 URL: https"],
      canApprovePermissions: true,
      canRevokePermissions: false,
      permissionVersion: "2.0.0",
    });
  });

  it("allows approved V3 permissions to be revoked", () => {
    const module = feature();
    const state = getModuleManagementState(feature({
      runtime: {
        ...module.runtime!,
        permissionStatus: "approved",
        permissionVersion: "1.0.0",
      },
    }), true);

    expect(state).toMatchObject({ canApprovePermissions: false, canRevokePermissions: true });
  });
});
