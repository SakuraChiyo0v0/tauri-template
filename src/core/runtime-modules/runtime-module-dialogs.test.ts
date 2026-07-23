import { describe, expect, it, vi } from "vitest";
import { createRuntimeModuleDialogBus } from "./runtime-module-dialogs";

describe("runtime module dialog bus", () => {
  it("serializes confirm and prompt requests through the renderer", async () => {
    const bus = createRuntimeModuleDialogBus();
    const render = vi.fn((request) => {
      queueMicrotask(() => request.resolve(request.kind === "confirm" ? true : "hello"));
    });
    bus.setRenderer(render);
    const api = bus.createModuleApi("local-notes");

    const confirmPromise = api.confirm({ title: "删除" });
    const promptPromise = api.prompt({ title: "重命名" });
    await Promise.all([confirmPromise, promptPromise]);

    expect(await confirmPromise).toBe(true);
    expect(await promptPromise).toBe("hello");
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.invocationCallOrder[0]).toBeLessThan(render.mock.invocationCallOrder[1]);
  });

  it("resolves confirm false and prompt null on cancel", async () => {
    const bus = createRuntimeModuleDialogBus();
    bus.setRenderer((request) => queueMicrotask(() => request.cancel()));
    const api = bus.createModuleApi("local-notes");

    expect(await api.confirm({ title: "保存" })).toBe(false);
    expect(await api.prompt({ title: "输入" })).toBeNull();
  });

  it("truncates long content before rendering", async () => {
    const bus = createRuntimeModuleDialogBus();
    const seen: string[] = [];
    bus.setRenderer((request) => {
      seen.push(request.title, request.message ?? "");
      queueMicrotask(() => request.resolve(request.kind === "confirm" ? true : "ok"));
    });
    const api = bus.createModuleApi("local-notes");
    await api.confirm({ title: "x".repeat(500), message: "y".repeat(5000) });
    expect(seen[0].length).toBeLessThanOrEqual(200);
    expect(seen[1].length).toBeLessThanOrEqual(2000);
  });

  it("cancels pending dialogs and rejects new calls after release", async () => {
    const bus = createRuntimeModuleDialogBus();
    const render = vi.fn(() => undefined);
    bus.setRenderer(render);
    const api = bus.createModuleApi("local-notes");
    const pending = api.confirm({ title: "等" });

    bus.releaseModule("local-notes");
    expect(await pending).toBe(false);
    await expect(api.confirm({ title: "新" })).rejects.toThrow(/released/i);
  });
});
