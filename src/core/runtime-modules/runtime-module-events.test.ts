import { describe, expect, it, vi } from "vitest";
import { createRuntimeModuleEventBus } from "./runtime-module-events";

describe("runtime module event bus", () => {
  it("delivers declared events to subscribers with isolated copies and a trusted envelope", async () => {
    const bus = createRuntimeModuleEventBus();
    const publisher = bus.createModuleApi("local-notes", ["notes.changed.v1"], []);
    const subscriberA = bus.createModuleApi("notes-dashboard", [], ["notes.changed.v1"]);
    const subscriberB = bus.createModuleApi("market-watcher", [], ["notes.changed.v1"]);
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    subscriberA.subscribe("notes.changed.v1", listenerA);
    subscriberB.subscribe("notes.changed.v1", listenerB);

    const payload = { change: "updated", noteId: 7 };
    publisher.publish("notes.changed.v1", payload);
    payload.noteId = 99;
    await bus.whenIdle();

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
    const envelopeA = listenerA.mock.calls[0][0];
    const envelopeB = listenerB.mock.calls[0][0];
    expect(envelopeA).toMatchObject({
      eventId: "notes.changed.v1",
      publisherModuleId: "local-notes",
      payload: { change: "updated", noteId: 7 },
    });
    expect(typeof envelopeA.publishedAt).toBe("string");
    expect(envelopeA.payload).not.toBe(payload);
    expect(envelopeA.payload).not.toBe(envelopeB.payload);
  });

  it("rejects undeclared or invalid publishes and subscriptions", () => {
    const bus = createRuntimeModuleEventBus();
    const publisher = bus.createModuleApi("local-notes", ["notes.changed.v1"], []);
    const subscriber = bus.createModuleApi("notes-dashboard", [], ["notes.changed.v1"]);

    expect(() => publisher.publish("other.v1", null)).toThrow(/declared/i);
    expect(() => publisher.publish("Invalid Event", null)).toThrow(/invalid event id/i);
    expect(() => subscriber.subscribe("other.v1", () => undefined)).toThrow(/declared/i);
    expect(() => subscriber.subscribe("Invalid Event", () => undefined)).toThrow(/invalid event id/i);
    expect(() => subscriber.subscribe("notes.changed.v1", null as never)).toThrow(/function/i);
  });

  it("delivers across modules without a dependency declaration and isolates listener failures", async () => {
    const onError = vi.fn();
    const bus = createRuntimeModuleEventBus({ onError });
    const publisher = bus.createModuleApi("local-notes", ["notes.changed.v1"], []);
    const failing = bus.createModuleApi("broken-watcher", [], ["notes.changed.v1"]);
    const healthy = bus.createModuleApi("notes-dashboard", [], ["notes.changed.v1"]);
    const healthyListener = vi.fn();
    failing.subscribe("notes.changed.v1", () => { throw new Error("listener exploded"); });
    failing.subscribe("notes.changed.v1", () => Promise.reject(new Error("async exploded")));
    healthy.subscribe("notes.changed.v1", healthyListener);

    publisher.publish("notes.changed.v1", { change: "created" });
    await bus.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(healthyListener).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0][1]).toMatchObject({
      eventId: "notes.changed.v1",
      publisherModuleId: "local-notes",
      subscriberModuleId: "broken-watcher",
    });
  });

  it("preserves publish order per publisher and supports independent unsubscription", async () => {
    const bus = createRuntimeModuleEventBus();
    const publisher = bus.createModuleApi("local-notes", ["notes.changed.v1"], []);
    const subscriber = bus.createModuleApi("notes-dashboard", [], ["notes.changed.v1"]);
    const seen: number[] = [];
    const unsubscribeFirst = subscriber.subscribe("notes.changed.v1", (event) => {
      seen.push((event.payload as { seq: number }).seq);
    });
    subscriber.subscribe("notes.changed.v1", (event) => {
      seen.push((event.payload as { seq: number }).seq * 10);
    });

    publisher.publish("notes.changed.v1", { seq: 1 });
    publisher.publish("notes.changed.v1", { seq: 2 });
    await bus.whenIdle();
    expect(seen).toEqual([1, 10, 2, 20]);

    unsubscribeFirst();
    publisher.publish("notes.changed.v1", { seq: 3 });
    await bus.whenIdle();
    expect(seen).toEqual([1, 10, 2, 20, 30]);
  });

  it("stops delivery after release, rejects released publishers, and never replays", async () => {
    const bus = createRuntimeModuleEventBus();
    const publisher = bus.createModuleApi("local-notes", ["notes.changed.v1"], []);
    const subscriber = bus.createModuleApi("notes-dashboard", [], ["notes.changed.v1"]);
    const listener = vi.fn();
    subscriber.subscribe("notes.changed.v1", listener);

    publisher.publish("notes.changed.v1", { change: "created" });
    await bus.whenIdle();
    expect(listener).toHaveBeenCalledTimes(1);

    bus.releaseModule("notes-dashboard");
    publisher.publish("notes.changed.v1", { change: "updated" });
    await bus.whenIdle();
    expect(listener).toHaveBeenCalledTimes(1);

    const lateSubscriber = bus.createModuleApi("late-watcher", [], ["notes.changed.v1"]);
    const lateListener = vi.fn();
    lateSubscriber.subscribe("notes.changed.v1", lateListener);
    await bus.whenIdle();
    expect(lateListener).not.toHaveBeenCalled();

    bus.releaseModule("local-notes");
    expect(() => publisher.publish("notes.changed.v1", null)).toThrow(/released/i);
    expect(() => subscriber.subscribe("notes.changed.v1", () => undefined)).toThrow(/released/i);
  });

  it("keeps other modules subscribed when one module is released", async () => {
    const bus = createRuntimeModuleEventBus();
    const publisher = bus.createModuleApi("local-notes", ["notes.changed.v1"], []);
    const released = bus.createModuleApi("notes-dashboard", [], ["notes.changed.v1"]);
    const surviving = bus.createModuleApi("market-watcher", [], ["notes.changed.v1"]);
    const survivingListener = vi.fn();
    released.subscribe("notes.changed.v1", vi.fn());
    surviving.subscribe("notes.changed.v1", survivingListener);

    bus.releaseModule("notes-dashboard");
    publisher.publish("notes.changed.v1", null);
    await bus.whenIdle();

    expect(survivingListener).toHaveBeenCalledTimes(1);
  });
});
