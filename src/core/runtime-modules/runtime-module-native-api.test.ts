import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { runtimeModuleNativeApi } from "./runtime-module-native-api";

describe("runtime module native bridge", () => {
  beforeEach(() => invoke.mockReset().mockResolvedValue(undefined));

  it("opens and reveals files by session-bound grant ID instead of a raw path", async () => {
    await runtimeModuleNativeApi.openPath("session-token", "selected-file");
    await runtimeModuleNativeApi.revealInFolder("session-token", "selected-file");

    expect(invoke).toHaveBeenNthCalledWith(1, "open_runtime_module_granted_file", {
      sessionToken: "session-token",
      grantId: "selected-file",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "reveal_runtime_module_granted_file", {
      sessionToken: "session-token",
      grantId: "selected-file",
    });
  });

  it("passes only opaque repository grant and plan identifiers to V6 commands", async () => {
    await runtimeModuleNativeApi.previewModuleRepositoryInstall(
      "session-token",
      "repository-grant",
      "target.mtp",
    );
    await runtimeModuleNativeApi.executeModuleRepositoryInstallPlan(
      "session-token",
      "repository-grant",
      "plan-token",
    );

    expect(invoke).toHaveBeenNthCalledWith(1, "preview_runtime_module_repository_install", {
      sessionToken: "session-token",
      grantId: "repository-grant",
      fileName: "target.mtp",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "execute_runtime_module_repository_install_plan", {
      sessionToken: "session-token",
      grantId: "repository-grant",
      planId: "plan-token",
    });
  });
});
