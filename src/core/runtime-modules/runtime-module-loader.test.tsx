import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeatureRegistry } from "@/core/features/feature-registry";
import type { RuntimeModuleHostSdk, InstalledRuntimeModule, RuntimeModulePlanSnapshot } from "./runtime-module-types";
import {
  activateRuntimeModule,
  createRuntimeFeature,
  discoverRuntimeModules,
  type RuntimeModuleLoaderDependencies,
} from "./runtime-module-loader";

const text = (value: string) => ({ "zh-CN": value, en: value });

function installedModule(): InstalledRuntimeModule {
  return {
    manifest: {
      schemaVersion: 2,
      id: "hello-module",
      name: text("Hello module"),
      description: text("A runtime test module"),
      version: "1.0.0",
      hostVersion: "^0.1.0",
      sdkVersion: 2,
      entry: "index.js",
      dependencies: { required: [], optional: [] },
      navigation: [
        {
          id: "hello-page",
          title: text("Hello"),
          description: text("Runtime page"),
          element: "hello-module-page",
          group: "main",
          order: 10,
        },
      ],
      settings: [
        {
          id: "showGreeting",
          type: "switch",
          group: "hello",
          label: text("Show greeting"),
          defaultValue: true,
        },
      ],
    },
    desiredEnabled: true,
    selectedVersion: "1.0.0",
    previousSelectedVersion: null,
    selectedSha256: "abc123",
    status: "active",
    diagnostics: [],
    requiredDependencies: [],
    optionalDependencies: [],
    dependents: [],
    activeVersion: "1.0.0",
    previousVersion: null,
    availableVersions: ["1.0.0"],
    activeSha256: "abc123",
    blockedVersion: null,
    lastError: null,
    permissionStatus: "not_required",
    permissionVersion: null,
    nativePermissionSummary: [],
    nativePermissionFingerprint: null,
  };
}

function sdk(): RuntimeModuleHostSdk {
  return {
    sdkVersion: 2,
    hostVersion: "0.1.0",
    module: { id: "hello-module", version: "1.0.0" },
    logger: {
      trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), write: vi.fn(),
    },
    settings: { get: (_id, fallback) => fallback, set: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
    theme: { get: () => ({ mode: "system", preset: "neutral" }), subscribe: vi.fn(() => vi.fn()) },
    i18n: { getLocale: () => "zh-CN", subscribe: vi.fn(() => vi.fn()) },
    database: {
      execute: vi.fn(), select: vi.fn(), transaction: vi.fn(), getUserVersion: vi.fn(), setUserVersion: vi.fn(),
    },
  };
}

function snapshot(modules: InstalledRuntimeModule[], activationOrder = modules.map((module) => module.manifest.id)): RuntimeModulePlanSnapshot {
  return {
    plan: {
      generation: 1,
      desiredEnabled: Object.fromEntries(modules.map((module) => [module.manifest.id, module.desiredEnabled])),
      selectedVersions: Object.fromEntries(modules.flatMap((module) => module.selectedVersion ? [[module.manifest.id, module.selectedVersion]] : [])),
      previousSelectedVersions: {},
      activationOrder,
      diagnostics: Object.fromEntries(modules.filter((module) => module.diagnostics.length > 0).map((module) => [module.manifest.id, module.diagnostics])),
    },
    modules,
  };
}

function operation(modules: InstalledRuntimeModule[], planChanged = false) {
  return {
    ...snapshot(modules),
    moduleId: modules[0]?.manifest.id ?? "unknown-module",
    packageInstalled: false,
    planChanged,
  };
}

function runtimeModule(id: string, requiredDependencies: string[] = []): InstalledRuntimeModule {
  const base = installedModule();
  return {
    ...base,
    manifest: {
      ...base.manifest,
      id,
      name: text(id),
      navigation: [],
      settings: [],
      dependencies: {
        required: requiredDependencies.map((dependencyId) => ({ id: dependencyId, version: "^1.0.0" })),
        optional: [],
      },
    },
    requiredDependencies: requiredDependencies.map((dependencyId) => ({ id: dependencyId, version: "^1.0.0" })),
  };
}

function dependencies(overrides: Partial<RuntimeModuleLoaderDependencies> = {}): RuntimeModuleLoaderDependencies {
  const module = installedModule();
  return {
    backend: {
      list: vi.fn(async () => snapshot([module])),
      readEntry: vi.fn(async () => ({ manifest: module.manifest, source: "export function activate() {}" })),
      reportActivationFailure: vi.fn(async () => operation([module])),
    },
    importSource: vi.fn(async () => ({ activate: vi.fn() })),
    createHostSdk: vi.fn(() => sdk()),
    releaseHostSdk: vi.fn(async () => undefined),
    elementRegistry: { get: vi.fn(() => class extends HTMLElement {}) },
    reload: vi.fn(),
    recoveryState: {
      get: vi.fn(() => null),
      set: vi.fn(),
      clear: vi.fn(),
    },
    getLegacyDisabledModuleIds: vi.fn(() => []),
    clearLegacyModuleState: vi.fn(),
    ...overrides,
  };
}

describe("runtime module loader", () => {
  it("converts manifest navigation and settings into a runtime feature", () => {
    const module = installedModule();
    const feature = createRuntimeFeature(module, vi.fn(async () => ({ activate: vi.fn() })));
    const Page = feature.navigation?.[0].component;

    expect(feature).toMatchObject({
      id: "hello-module",
      source: "runtime",
      version: "1.0.0",
      elementNames: ["hello-module-page"],
      settings: [{ id: "showGreeting", type: "switch" }],
    });
    const { container } = render(Page ? <Page /> : null);
    expect(container.querySelector("hello-module-page")).not.toBeNull();
  });

  it("imports the entry, activates it with the host SDK, and validates declared elements", async () => {
    const activate = vi.fn();
    const deps = dependencies({ importSource: vi.fn(async () => ({ activate })) });

    await activateRuntimeModule(installedModule(), deps);

    expect(activate).toHaveBeenCalledWith(expect.objectContaining({
      sdkVersion: 2,
      module: { id: "hello-module", version: "1.0.0" },
    }));
  });

  it("rejects activation when a declared custom element is missing", async () => {
    const deps = dependencies({ elementRegistry: { get: vi.fn(() => undefined) } });

    await expect(activateRuntimeModule(installedModule(), deps)).rejects.toThrow(/hello-module-page/);
    expect(deps.releaseHostSdk).toHaveBeenCalledTimes(1);
  });

  it("releases the native session after runtime feature teardown", async () => {
    const deactivate = vi.fn();
    const deps = dependencies({
      importSource: vi.fn(async () => ({ activate: vi.fn(), deactivate })),
    });
    const registry = new FeatureRegistry();
    await discoverRuntimeModules(registry, deps);

    registry.unregister("hello-module");

    await vi.waitFor(() => expect(deactivate).toHaveBeenCalledTimes(1));
    expect(deps.releaseHostSdk).toHaveBeenCalledTimes(1);
  });

  it("rejects an entry without activate(hostSdk)", async () => {
    const deps = dependencies({ importSource: vi.fn(async () => ({} as never)) });

    await expect(activateRuntimeModule(installedModule(), deps)).rejects.toThrow(/activate\(hostSdk\)/);
  });

  it("leaves builtin features available when no runtime module is installed", async () => {
    const registry = new FeatureRegistry().register({
      id: "builtin-shell",
      name: text("Shell"),
      description: text("Builtin shell"),
      version: "1.0.0",
      defaultEnabled: true,
    });
    const deps = dependencies({
      backend: {
        list: vi.fn(async () => snapshot([])),
        readEntry: vi.fn(),
        reportActivationFailure: vi.fn(),
      },
    });

    await discoverRuntimeModules(registry, deps);

    expect(registry.getAll().map((feature) => feature.id)).toEqual(["builtin-shell"]);
  });

  it("activates selected modules in the provider-first plan order", async () => {
    const provider = runtimeModule("data-provider");
    const consumer = runtimeModule("report-consumer", ["data-provider"]);
    const calls: string[] = [];
    const deps = dependencies({
      backend: {
        list: vi.fn(async () => snapshot([consumer, provider], ["data-provider", "report-consumer"])),
        readEntry: vi.fn(async (moduleId) => {
          const module = moduleId === provider.manifest.id ? provider : consumer;
          return { manifest: module.manifest, source: moduleId };
        }),
        reportActivationFailure: vi.fn(),
      },
      importSource: vi.fn(async (_source, moduleId) => ({ activate: vi.fn(() => { calls.push(moduleId); }) })),
    });

    await discoverRuntimeModules(new FeatureRegistry(), deps);

    expect(calls).toEqual(["data-provider", "report-consumer"]);
  });

  it("keeps waiting modules visible without executing their entry", async () => {
    const waiting = {
      ...runtimeModule("report-consumer", ["data-provider"]),
      selectedVersion: null,
      selectedSha256: null,
      status: "waiting" as const,
    };
    const readEntry = vi.fn();
    const registry = new FeatureRegistry();
    await discoverRuntimeModules(registry, dependencies({
      backend: {
        list: vi.fn(async () => snapshot([waiting], [])),
        readEntry,
        reportActivationFailure: vi.fn(),
      },
    }));

    expect(readEntry).not.toHaveBeenCalled();
    expect(registry.getManageable()[0].runtime?.status).toBe("waiting");
  });

  it("does not create a session or execute an unapproved V3 module", async () => {
    const waiting = {
      ...installedModule(),
      manifest: {
        ...installedModule().manifest,
        sdkVersion: 3 as const,
        nativeCapabilities: {
          filesystem: { private: true, external: [] },
          process: null,
          registry: [],
          tray: [],
          shortcuts: [],
        },
      },
      selectedVersion: null,
      selectedSha256: null,
      status: "waiting" as const,
      permissionStatus: "awaiting_approval" as const,
    };
    const readEntry = vi.fn();
    const createHostSdk = vi.fn();

    await discoverRuntimeModules(new FeatureRegistry(), dependencies({
      backend: {
        list: vi.fn(async () => snapshot([waiting], [])),
        readEntry,
        reportActivationFailure: vi.fn(),
      },
      createHostSdk,
    }));

    expect(readEntry).not.toHaveBeenCalled();
    expect(createHostSdk).not.toHaveBeenCalled();
  });

  it("skips failed provider dependents but continues an independent branch", async () => {
    const provider = runtimeModule("data-provider");
    const consumer = runtimeModule("report-consumer", ["data-provider"]);
    const independent = runtimeModule("independent-module");
    const activated: string[] = [];
    const readEntry = vi.fn(async (moduleId: string) => ({
      manifest: [provider, consumer, independent].find((module) => module.manifest.id === moduleId)!.manifest,
      source: moduleId,
    }));
    const failedProvider = { ...provider, selectedVersion: null, selectedSha256: null, status: "blocked" as const };
    const deps = dependencies({
      backend: {
        list: vi.fn(async () => snapshot([consumer, independent, provider], ["data-provider", "independent-module", "report-consumer"])),
        readEntry,
        reportActivationFailure: vi.fn(async () => operation([failedProvider, consumer, independent])),
      },
      importSource: vi.fn(async (_source, moduleId) => ({
        activate: vi.fn(() => {
          if (moduleId === "data-provider") throw new Error("provider failed");
          activated.push(moduleId);
        }),
      })),
    });
    const registry = new FeatureRegistry();

    await discoverRuntimeModules(registry, deps);

    expect(readEntry.mock.calls.map(([moduleId]) => moduleId)).toEqual(["data-provider", "independent-module"]);
    expect(activated).toEqual(["independent-module"]);
    expect(registry.getManageable().find((feature) => feature.id === "report-consumer")?.runtime?.diagnostics[0].code)
      .toBe("upstream_activation_failed");
  });

  it("passes legacy disabled IDs once and clears runtime entries after migration", async () => {
    const module = installedModule();
    const list = vi.fn(async () => snapshot([module]));
    const clearLegacyModuleState = vi.fn();
    const deps = dependencies({
      backend: { list, readEntry: vi.fn(async () => ({ manifest: module.manifest, source: "entry" })), reportActivationFailure: vi.fn() },
      getLegacyDisabledModuleIds: vi.fn(() => ["hello-module", "builtin-shell"]),
      clearLegacyModuleState,
    });

    await discoverRuntimeModules(new FeatureRegistry(), deps);

    expect(list).toHaveBeenCalledWith(["hello-module", "builtin-shell"]);
    expect(clearLegacyModuleState).toHaveBeenCalledWith(["hello-module"]);
  });

  it("reports activation failure and reloads once after backend rollback", async () => {
    const module = installedModule();
    const recovered = { ...module, selectedVersion: "0.9.0", activeVersion: "0.9.0", previousVersion: "1.0.0" };
    const reportActivationFailure = vi.fn(async () => operation([recovered], true));
    const reload = vi.fn();
    const recoveryState = { get: vi.fn(() => null), set: vi.fn(), clear: vi.fn() };
    const deps = dependencies({
      backend: {
        list: vi.fn(async () => snapshot([module])),
        readEntry: vi.fn(async () => ({ manifest: module.manifest, source: "broken" })),
        reportActivationFailure,
      },
      importSource: vi.fn(async () => ({ activate: vi.fn(async () => { throw new Error("boom"); }) })),
      reload,
      recoveryState,
    });
    const registry = new FeatureRegistry();

    await discoverRuntimeModules(registry, deps);

    expect(reportActivationFailure).toHaveBeenCalledWith("hello-module", "1.0.0", expect.stringContaining("boom"));
    expect(deps.releaseHostSdk).toHaveBeenCalledTimes(1);
    expect(recoveryState.set).toHaveBeenCalledWith("hello-module", "1.0.0");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(registry.getNavigation()).toEqual([]);
  });
});
