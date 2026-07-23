import { createModuleLogger } from "@/features/logging/logger";
import { cloneServiceValue } from "./runtime-module-services";
import type {
  RuntimeModuleEventEnvelope,
  RuntimeModuleEvents,
  RuntimeServiceValue,
} from "./runtime-module-types";

const eventIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

export interface RuntimeModuleEventErrorContext {
  readonly eventId: string;
  readonly publisherModuleId: string;
  readonly subscriberModuleId: string;
}

export type RuntimeModuleEventErrorHandler = (
  error: unknown,
  context: RuntimeModuleEventErrorContext,
) => void;

interface SubscriptionRecord {
  readonly eventId: string;
  readonly subscriberModuleId: string;
  readonly listener: (event: RuntimeModuleEventEnvelope) => void;
}

function defaultErrorHandler(error: unknown, context: RuntimeModuleEventErrorContext) {
  const message = error instanceof Error ? error.message : String(error);
  void createModuleLogger(context.subscriberModuleId)
    .error(`Event listener for ${context.eventId} published by ${context.publisherModuleId} failed: ${message}`)
    .catch(() => undefined);
}

export class RuntimeModuleEventBus {
  private readonly subscriptions = new Set<SubscriptionRecord>();
  private readonly moduleSessions = new Map<string, Set<() => void>>();
  private readonly moduleSubscriptions = new Map<string, Set<() => void>>();
  private queue: Promise<void> = Promise.resolve();
  private readonly onError: RuntimeModuleEventErrorHandler;

  constructor(onError: RuntimeModuleEventErrorHandler = defaultErrorHandler) {
    this.onError = onError;
  }

  createModuleApi(
    moduleId: string,
    declaredPublishes: readonly string[],
    declaredSubscribes: readonly string[],
  ): RuntimeModuleEvents {
    let active = true;
    const publishes = new Set(declaredPublishes);
    const subscribes = new Set(declaredSubscribes);
    const release = () => { active = false; };
    const sessions = this.moduleSessions.get(moduleId) ?? new Set<() => void>();
    sessions.add(release);
    this.moduleSessions.set(moduleId, sessions);
    const assertActive = () => {
      if (!active) throw new Error(`Host SDK events for module ${moduleId} have been released.`);
    };

    return {
      publish: (eventId, payload: RuntimeServiceValue = null) => {
        assertActive();
        if (!eventIdPattern.test(eventId)) throw new Error(`Invalid event id: ${eventId}.`);
        if (!publishes.has(eventId)) throw new Error(`Event ${eventId} is not declared as publishable by module ${moduleId}.`);
        const snapshot = cloneServiceValue(payload, "Event payload");
        const publishedAt = new Date().toISOString();
        const targets = [...this.subscriptions].filter((record) => record.eventId === eventId);

        this.queue = this.queue
          .then(() => {
            for (const target of targets) {
              if (!this.subscriptions.has(target)) continue;
              const envelope: RuntimeModuleEventEnvelope = {
                eventId,
                publisherModuleId: moduleId,
                publishedAt,
                payload: cloneServiceValue(snapshot, "Event payload"),
              };
              try {
                const result = target.listener(envelope) as unknown;
                if (result && typeof (result as Promise<unknown>).then === "function") {
                  (result as Promise<unknown>).catch((error: unknown) => this.onError(error, {
                    eventId,
                    publisherModuleId: moduleId,
                    subscriberModuleId: target.subscriberModuleId,
                  }));
                }
              } catch (error) {
                this.onError(error, {
                  eventId,
                  publisherModuleId: moduleId,
                  subscriberModuleId: target.subscriberModuleId,
                });
              }
            }
          })
          .catch(() => undefined);
      },
      subscribe: (eventId, listener) => {
        assertActive();
        if (!eventIdPattern.test(eventId)) throw new Error(`Invalid event id: ${eventId}.`);
        if (!subscribes.has(eventId)) throw new Error(`Event ${eventId} is not declared as subscribable by module ${moduleId}.`);
        if (typeof listener !== "function") throw new Error(`Event listener for ${eventId} must be a function.`);
        const record: SubscriptionRecord = { eventId, subscriberModuleId: moduleId, listener };
        this.subscriptions.add(record);
        const unsubscribe = () => {
          this.subscriptions.delete(record);
          this.moduleSubscriptions.get(moduleId)?.delete(unsubscribe);
        };
        let moduleUnsubscribes = this.moduleSubscriptions.get(moduleId);
        if (!moduleUnsubscribes) {
          moduleUnsubscribes = new Set();
          this.moduleSubscriptions.set(moduleId, moduleUnsubscribes);
        }
        moduleUnsubscribes.add(unsubscribe);
        return unsubscribe;
      },
    };
  }

  releaseModule(moduleId: string) {
    this.moduleSessions.get(moduleId)?.forEach((release) => release());
    this.moduleSessions.delete(moduleId);
    this.moduleSubscriptions.get(moduleId)?.forEach((unsubscribe) => unsubscribe());
    this.moduleSubscriptions.delete(moduleId);
  }

  whenIdle(): Promise<void> {
    return this.queue;
  }
}

export function createRuntimeModuleEventBus(options?: { onError?: RuntimeModuleEventErrorHandler }) {
  return new RuntimeModuleEventBus(options?.onError);
}

export const runtimeModuleEventBus = createRuntimeModuleEventBus();
