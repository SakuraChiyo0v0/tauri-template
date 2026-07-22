import type {
  RuntimeModuleServices,
  RuntimeServiceHandler,
  RuntimeServiceValue,
} from "./runtime-module-types";

const serviceIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const methodPattern = /^[a-z][A-Za-z0-9]{0,63}$/;
const blockedKeys = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 32;
const MAX_BYTES = 256 * 1024;

interface ServiceRegistration {
  ownerModuleId: string;
  handlers: Record<string, RuntimeServiceHandler>;
}

function cloneServiceValue(value: unknown, label: string) {
  const seen = new Set<object>();

  const clone = (current: unknown, depth: number): RuntimeServiceValue => {
    if (depth > MAX_DEPTH) throw new Error(`${label} is not a supported service value: maximum depth exceeded.`);
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error(`${label} is not a supported service value: numbers must be finite.`);
      return current;
    }
    if (typeof current !== "object") throw new Error(`${label} is not a supported service value.`);
    if (seen.has(current)) throw new Error(`${label} is not a supported service value: circular reference.`);
    seen.add(current);
    try {
      if (Array.isArray(current)) return current.map((item) => clone(item, depth + 1));
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`${label} is not a supported service value: only plain objects are allowed.`);
      }
      const result: Record<string, RuntimeServiceValue> = {};
      for (const [key, item] of Object.entries(current)) {
        if (blockedKeys.has(key)) throw new Error(`${label} is not a supported service value: unsafe object key.`);
        result[key] = clone(item, depth + 1);
      }
      return result;
    } finally {
      seen.delete(current);
    }
  };

  const result = clone(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_BYTES) {
    throw new Error(`${label} is not a supported service value: maximum size exceeded.`);
  }
  return result;
}

export class RuntimeModuleServiceBus {
  private readonly services = new Map<string, ServiceRegistration>();
  private readonly moduleSessions = new Map<string, Set<() => void>>();

  createModuleApi(
    moduleId: string,
    declaredServices: readonly string[],
    dependencies: readonly string[],
  ): RuntimeModuleServices {
    let active = true;
    const allowedServices = new Set(declaredServices);
    const allowedProviders = new Set(dependencies);
    const keyOf = (providerModuleId: string, serviceId: string) => `${providerModuleId}\u0000${serviceId}`;
    const release = () => { active = false; };
    const sessions = this.moduleSessions.get(moduleId) ?? new Set<() => void>();
    sessions.add(release);
    this.moduleSessions.set(moduleId, sessions);
    const assertActive = () => {
      if (!active) throw new Error(`Host SDK services for module ${moduleId} have been released.`);
    };

    return {
      expose: (serviceId, handlers) => {
        assertActive();
        if (!allowedServices.has(serviceId)) throw new Error(`Service ${serviceId} is not declared by module ${moduleId}.`);
        if (!serviceIdPattern.test(serviceId)) throw new Error(`Invalid service id: ${serviceId}.`);
        const entries = Object.entries(handlers);
        if (entries.length === 0 || entries.some(([method, handler]) => !methodPattern.test(method) || typeof handler !== "function")) {
          throw new Error(`Service ${moduleId}/${serviceId} must contain valid handler methods.`);
        }
        const key = keyOf(moduleId, serviceId);
        if (this.services.has(key)) throw new Error(`Service ${moduleId}/${serviceId} is already registered.`);
        const registration = { ownerModuleId: moduleId, handlers: { ...handlers } };
        this.services.set(key, registration);
        return () => {
          if (this.services.get(key) === registration) this.services.delete(key);
        };
      },
      available: (providerModuleId, serviceId) => {
        assertActive();
        if (!allowedProviders.has(providerModuleId)) return false;
        return this.services.has(keyOf(providerModuleId, serviceId));
      },
      call: async <T extends RuntimeServiceValue>(providerModuleId: string, serviceId: string, method: string, input: RuntimeServiceValue = null) => {
        assertActive();
        if (!allowedProviders.has(providerModuleId)) {
          throw new Error(`Module ${providerModuleId} is not a declared dependency of ${moduleId}.`);
        }
        const registration = this.services.get(keyOf(providerModuleId, serviceId));
        if (!registration) throw new Error(`Service ${providerModuleId}/${serviceId} is not available.`);
        if (!Object.prototype.hasOwnProperty.call(registration.handlers, method)) {
          throw new Error(`Service method ${providerModuleId}/${serviceId}.${method} is not available.`);
        }
        const handler = registration.handlers[method];
        const safeInput = cloneServiceValue(input, "Service input");
        const output = await handler(safeInput);
        return cloneServiceValue(output, "Service output") as T;
      },
    };
  }

  releaseModule(moduleId: string) {
    this.moduleSessions.get(moduleId)?.forEach((release) => release());
    this.moduleSessions.delete(moduleId);
    for (const [key, registration] of this.services) {
      if (registration.ownerModuleId === moduleId) this.services.delete(key);
    }
  }
}

export function createRuntimeModuleServiceBus() {
  return new RuntimeModuleServiceBus();
}

export const runtimeModuleServiceBus = createRuntimeModuleServiceBus();
