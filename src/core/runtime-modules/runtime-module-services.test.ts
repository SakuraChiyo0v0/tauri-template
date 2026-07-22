import { describe, expect, it, vi } from "vitest";
import { createRuntimeModuleServiceBus } from "./runtime-module-services";

describe("runtime module service bus", () => {
  it("allows a declared dependency to call a declared service with isolated values", async () => {
    const bus = createRuntimeModuleServiceBus();
    const provider = bus.createModuleApi("local-notes", ["notes.v1"], []);
    const consumer = bus.createModuleApi("notes-dashboard", [], ["local-notes"]);
    const inputSeen = vi.fn();
    const providerResult = { count: 2, recent: [{ id: 1, title: "Hello" }] };

    provider.expose("notes.v1", {
      stats(input) {
        inputSeen(input);
        return providerResult;
      },
    });
    const input = { limit: 3 };
    const result = await consumer.call<typeof providerResult>("local-notes", "notes.v1", "stats", input);

    expect(inputSeen).toHaveBeenCalledWith(input);
    expect(inputSeen.mock.calls[0][0]).not.toBe(input);
    expect(result).toEqual(providerResult);
    expect(result).not.toBe(providerResult);
    expect(consumer.available("local-notes", "notes.v1")).toBe(true);
  });

  it("rejects undeclared services, duplicate registration, and undeclared dependency calls", async () => {
    const bus = createRuntimeModuleServiceBus();
    const provider = bus.createModuleApi("local-notes", ["notes.v1"], []);
    const stranger = bus.createModuleApi("unrelated-module", [], []);

    expect(() => provider.expose("other.v1", { run: () => null })).toThrow(/declared/i);
    provider.expose("notes.v1", { stats: () => ({ count: 0 }) });
    expect(() => provider.expose("notes.v1", { stats: () => ({ count: 1 }) })).toThrow(/registered/i);
    await expect(stranger.call("local-notes", "notes.v1", "stats", null)).rejects.toThrow(/dependency/i);
  });

  it("rejects unsupported values and unregisters all services on release", async () => {
    const bus = createRuntimeModuleServiceBus();
    const provider = bus.createModuleApi("local-notes", ["notes.v1"], []);
    const consumer = bus.createModuleApi("notes-dashboard", [], ["local-notes"]);
    const handler = vi.fn(() => ({ count: 1 }));
    provider.expose("notes.v1", { stats: handler, invalid: () => ({ value: BigInt(1) } as never) });

    await expect(consumer.call("local-notes", "notes.v1", "stats", { callback: () => undefined } as never))
      .rejects.toThrow(/service value/i);
    expect(handler).not.toHaveBeenCalled();
    await expect(consumer.call("local-notes", "notes.v1", "invalid", null)).rejects.toThrow(/service value/i);

    bus.releaseModule("local-notes");
    expect(consumer.available("local-notes", "notes.v1")).toBe(false);
    await expect(consumer.call("local-notes", "notes.v1", "stats", null)).rejects.toThrow(/not available/i);
    expect(() => provider.expose("notes.v1", { stats: () => null })).toThrow(/released/i);
  });

  it("does not dispatch inherited object methods as service handlers", async () => {
    const bus = createRuntimeModuleServiceBus();
    bus.createModuleApi("local-notes", ["notes.v1"], []).expose("notes.v1", { stats: () => null });
    const consumer = bus.createModuleApi("notes-dashboard", [], ["local-notes"]);

    await expect(consumer.call("local-notes", "notes.v1", "toString", null)).rejects.toThrow(/not available/i);
  });
});
