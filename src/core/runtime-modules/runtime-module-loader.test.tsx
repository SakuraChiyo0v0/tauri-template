import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeatureRegistry } from "@/core/features/feature-registry";
import type { RuntimeModuleHostSdk, InstalledRuntimeModule } from "./runtime-module-types";
import {
  activateRuntimeModule,
  createRuntimeFeature,
  discoverRuntimeModules,
  type RuntimeModuleLoaderDependencies,
} from "./runtime-module-loader";

function installedModule(): InstalledRuntimeModule {
  return {
    manifest: {
      schemaVersion: 1,
      id: "hello-module",
      name: "Hello module",
      description: "A runtime test module",
      version: "1.0.0",
      hostVersion: "^0.1.0",
      sdkVersion: 1,
      entry: "index.js",
      navigation: [
        {
          id: "hello-page",
          title: "Hello",
          description: "Runtime page",
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
          label: "Show greeting",
          defaultValue: true,
        },
      ],
    },
    activeVersion: "1.0.0",
    previousVersion: null,
    availableVersions: ["1.0.0"],
    activeSha256: "abc123",
    blockedVersion: null,
    lastError: null,
  };
}

function sdk(): RuntimeModuleHostSdk {
  return {
    sdkVersion: 1,
    hostVersion: "0.1.0",
    module: { id: "hello-module", version: "1.0.0" },
    logger: {
      trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), write: vi.fn(),
    },
    settings: { get: (_id, fallback) => fallback, set: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
    theme: { get: () => ({ mode: "system", preset: "neutral" }), subscribe: vi.fn(() => vi.fn()) },
  };
}

function dependencies(overrides: Partial<RuntimeModuleLoaderDependencies> = {}): RuntimeModuleLoaderDependencies {
  const module = installedModule();
  return {
    backend: {
      list: vi.fn(async () => [module]),
      readEntry: vi.fn(async () => ({ manifest: module.manifest, source: "export function activate() {}" })),
      reportActivationFailure: vi.fn(async () => ({ module, rolledBack: false })),
    },
    importSource: vi.fn(async () => ({ activate: vi.fn() })),
    createHostSdk: vi.fn(() => sdk()),
    elementRegistry: { get: vi.fn(() => class extends HTMLElement {}) },
    reload: vi.fn(),
    recoveryState: {
      get: vi.fn(() => null),
      set: vi.fn(),
      clear: vi.fn(),
    },
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
      sdkVersion: 1,
      module: { id: "hello-module", version: "1.0.0" },
    }));
  });

  it("rejects activation when a declared custom element is missing", async () => {
    const deps = dependencies({ elementRegistry: { get: vi.fn(() => undefined) } });

    await expect(activateRuntimeModule(installedModule(), deps)).rejects.toThrow(/hello-module-page/);
  });

  it("rejects an entry without activate(hostSdk)", async () => {
    const deps = dependencies({ importSource: vi.fn(async () => ({} as never)) });

    await expect(activateRuntimeModule(installedModule(), deps)).rejects.toThrow(/activate\(hostSdk\)/);
  });

  it("leaves builtin features available when no runtime module is installed", async () => {
    const registry = new FeatureRegistry().register({
      id: "builtin-shell",
      name: "Shell",
      description: "Builtin shell",
      version: "1.0.0",
      defaultEnabled: true,
    });
    const deps = dependencies({
      backend: {
        list: vi.fn(async () => []),
        readEntry: vi.fn(),
        reportActivationFailure: vi.fn(),
      },
    });

    await discoverRuntimeModules(registry, deps);

    expect(registry.getAll().map((feature) => feature.id)).toEqual(["builtin-shell"]);
  });

  it("reports activation failure and reloads once after backend rollback", async () => {
    const module = installedModule();
    const recovered = { ...module, activeVersion: "0.9.0", previousVersion: "1.0.0" };
    const reportActivationFailure = vi.fn(async () => ({ module: recovered, rolledBack: true }));
    const reload = vi.fn();
    const recoveryState = { get: vi.fn(() => null), set: vi.fn(), clear: vi.fn() };
    const deps = dependencies({
      backend: {
        list: vi.fn(async () => [module]),
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
    expect(recoveryState.set).toHaveBeenCalledWith("hello-module", "1.0.0");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(registry.getNavigation()).toEqual([]);
  });
});
