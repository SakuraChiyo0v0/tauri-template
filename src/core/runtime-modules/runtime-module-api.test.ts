import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => true,
}));

import { runtimeModuleApi } from "./runtime-module-api";

describe("runtime module permission management API", () => {
  beforeEach(() => invoke.mockReset().mockResolvedValue({}));

  it("routes approval and revocation through explicit host commands", async () => {
    await runtimeModuleApi.approveNativePermissions("native-tools", "2.0.0");
    await runtimeModuleApi.revokeNativePermissions("native-tools");

    expect(invoke).toHaveBeenNthCalledWith(1, "approve_runtime_module_native_permissions", {
      moduleId: "native-tools",
      version: "2.0.0",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "revoke_runtime_module_native_permissions", {
      moduleId: "native-tools",
    });
  });

  it("routes file grants and shortcut conflict resolution without exposing paths to modules", async () => {
    await runtimeModuleApi.createFileGrant("native-tools", "C:\\picked\\data.txt", "file", {
      read: true, write: false, list: false, execute: false,
    });
    await runtimeModuleApi.rebindShortcut("native-tools", "show-main", "Ctrl+Shift+Y");

    expect(invoke).toHaveBeenNthCalledWith(1, "create_runtime_module_file_grant", expect.objectContaining({
      moduleId: "native-tools",
      kind: "file",
    }));
    expect(invoke).toHaveBeenNthCalledWith(2, "rebind_runtime_module_shortcut", {
      moduleId: "native-tools",
      shortcutId: "show-main",
      accelerator: "Ctrl+Shift+Y",
    });
  });
});
