import { Puzzle } from "lucide-react";
import type { FeatureRegistry } from "@/core/features/feature-registry";
import { clearLegacyFeatureState, getLegacyDisabledFeatureIds } from "@/core/features/feature-state";
import { defineFeature, type FeatureModule } from "@/core/features/feature-types";
import { parseRuntimeModuleManifest } from "./runtime-manifest";
import { runtimeModuleApi, type RuntimeModuleApi } from "./runtime-module-api";
import { createRuntimeModuleHostSdk } from "./runtime-module-sdk";
import { createRuntimeModulePage } from "./runtime-module-page";
import type {
  InstalledRuntimeModule,
  RuntimeModuleExports,
  RuntimeModuleHostSdk,
} from "./runtime-module-types";

type LoaderBackend = Pick<RuntimeModuleApi, "list" | "readEntry" | "reportActivationFailure">;

export interface RuntimeRecoveryState {
  get(moduleId: string): string | null;
  set(moduleId: string, failedVersion: string): void;
  clear(moduleId: string): void;
}

export interface RuntimeModuleLoaderDependencies {
  backend: LoaderBackend;
  importSource(source: string, moduleId: string, version: string): Promise<RuntimeModuleExports>;
  createHostSdk(module: InstalledRuntimeModule): RuntimeModuleHostSdk;
  elementRegistry: Pick<CustomElementRegistry, "get">;
  reload(): void;
  recoveryState: RuntimeRecoveryState;
  getLegacyDisabledModuleIds(): string[];
  clearLegacyModuleState(moduleIds: readonly string[]): void;
}

const RECOVERY_KEY_PREFIX = "modular-tauri.runtime-recovery.v1.";

function browserRecoveryState(): RuntimeRecoveryState {
  return {
    get: (moduleId) => sessionStorage.getItem(`${RECOVERY_KEY_PREFIX}${moduleId}`),
    set: (moduleId, version) => sessionStorage.setItem(`${RECOVERY_KEY_PREFIX}${moduleId}`, version),
    clear: (moduleId) => sessionStorage.removeItem(`${RECOVERY_KEY_PREFIX}${moduleId}`),
  };
}

async function importModuleSource(source: string, moduleId: string, version: string) {
  const sourceUrl = `mtp://${moduleId}/${version}/index.js`;
  const blob = new Blob([source, `\n//# sourceURL=${sourceUrl}`], { type: "text/javascript" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ blobUrl) as RuntimeModuleExports;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function createDefaultRuntimeModuleLoaderDependencies(): RuntimeModuleLoaderDependencies {
  return {
    backend: runtimeModuleApi,
    importSource: importModuleSource,
    createHostSdk: createRuntimeModuleHostSdk,
    elementRegistry: customElements,
    reload: () => location.reload(),
    recoveryState: browserRecoveryState(),
    getLegacyDisabledModuleIds: getLegacyDisabledFeatureIds,
    clearLegacyModuleState: clearLegacyFeatureState,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function activateRuntimeModule(
  module: InstalledRuntimeModule,
  dependencies: RuntimeModuleLoaderDependencies,
): Promise<RuntimeModuleExports> {
  const entry = await dependencies.backend.readEntry(module.manifest.id);
  const manifest = parseRuntimeModuleManifest(entry.manifest);
  if (!module.selectedVersion) throw new Error(`模块 ${module.manifest.id} 没有可激活的选择版本。`);
  if (manifest.id !== module.manifest.id || manifest.version !== module.selectedVersion) {
    throw new Error(`模块入口身份不匹配：期望 ${module.manifest.id}@${module.selectedVersion}。`);
  }

  const exports = await dependencies.importSource(entry.source, manifest.id, manifest.version);
  if (typeof exports.activate !== "function") {
    throw new Error(`模块 ${manifest.id}@${manifest.version} 未导出 activate(hostSdk)。`);
  }

  await exports.activate(dependencies.createHostSdk(module));
  const missingElements = manifest.navigation
    .map((navigation) => navigation.element)
    .filter((elementName) => !dependencies.elementRegistry.get(elementName));
  if (missingElements.length > 0) {
    throw new Error(`模块激活后缺少自定义元素：${missingElements.join(", ")}`);
  }

  dependencies.recoveryState.clear(manifest.id);
  return exports;
}

export function createRuntimeFeature(
  module: InstalledRuntimeModule,
  activate: () => Promise<RuntimeModuleExports>,
): FeatureModule {
  let activeExports: RuntimeModuleExports | undefined;
  const manifest = parseRuntimeModuleManifest(module.manifest);

  return defineFeature({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    defaultEnabled: module.desiredEnabled,
    source: "runtime",
    runtime: module,
    elementNames: manifest.navigation.map((navigation) => navigation.element),
    navigation: manifest.navigation.map((navigation) => ({
      id: navigation.id,
      title: navigation.title,
      description: navigation.description,
      icon: Puzzle,
      component: createRuntimeModulePage(manifest.id, navigation.element),
      group: navigation.group,
      order: navigation.order,
    })),
    settings: manifest.settings,
    async setup() {
      activeExports ??= await activate();
    },
    async teardown() {
      const current = activeExports;
      activeExports = undefined;
      await current?.deactivate?.();
    },
  });
}

function createDiagnosticFeature(module: InstalledRuntimeModule): FeatureModule {
  return defineFeature({
    id: module.manifest.id,
    name: module.manifest.name,
    description: module.manifest.description,
    version: module.selectedVersion ?? module.manifest.version,
    defaultEnabled: module.desiredEnabled,
    source: "runtime",
    runtime: module,
    navigation: [],
    settings: [],
  });
}

async function reportFailure(
  module: InstalledRuntimeModule,
  error: unknown,
  registry: FeatureRegistry,
  dependencies: RuntimeModuleLoaderDependencies,
): Promise<boolean> {
  registry.unregister(module.manifest.id);
  const result = await dependencies.backend.reportActivationFailure(
    module.manifest.id,
    module.selectedVersion as string,
    errorMessage(error),
  );

  const updated = result.modules.find((entry) => entry.manifest.id === module.manifest.id);
  if (updated) {
    try {
      registry.register(createDiagnosticFeature(updated));
    } catch (registrationError) {
      console.error(`无法注册模块 ${module.manifest.id} 的诊断信息。`, registrationError);
    }
  }

  if (result.planChanged && dependencies.recoveryState.get(module.manifest.id) === null) {
    dependencies.recoveryState.set(module.manifest.id, module.selectedVersion as string);
    return true;
  }
  return false;
}

export async function discoverRuntimeModules(
  registry: FeatureRegistry,
  dependencies = createDefaultRuntimeModuleLoaderDependencies(),
) {
  const snapshot = await dependencies.backend.list(dependencies.getLegacyDisabledModuleIds());
  dependencies.clearLegacyModuleState(snapshot.modules.map((module) => module.manifest.id));
  const modulesById = new Map(snapshot.modules.map((module) => [module.manifest.id, module]));
  const failed = new Set<string>();
  let shouldReload = false;

  for (const module of snapshot.modules) {
    if (module.status !== "active" || !module.selectedVersion) {
      registry.register(createDiagnosticFeature(module));
    }
  }

  for (const moduleId of snapshot.plan.activationOrder) {
    const module = modulesById.get(moduleId);
    if (!module || module.status !== "active" || !module.selectedVersion) continue;
    if (module.requiredDependencies.some((dependency) => failed.has(dependency.id))) {
      failed.add(moduleId);
      registry.register(createDiagnosticFeature({
        ...module,
        status: "blocked",
        diagnostics: [...module.diagnostics, {
          code: "upstream_activation_failed",
          moduleId,
          dependencyId: null,
          requiredVersion: null,
          availableVersions: [],
          relatedModules: module.requiredDependencies
            .filter((dependency) => failed.has(dependency.id))
            .map((dependency) => dependency.id),
        }],
      }));
      continue;
    }

    const feature = createRuntimeFeature(module, () => activateRuntimeModule(module, dependencies));
    try {
      registry.register(feature);
      await feature.setup?.();
    } catch (error) {
      failed.add(moduleId);
      try {
        shouldReload = await reportFailure(module, error, registry, dependencies) || shouldReload;
      } catch (reportError) {
        console.error(`无法记录模块 ${module.manifest.id} 的激活失败。`, reportError);
      }
    }
  }

  if (shouldReload) dependencies.reload();

  return snapshot.modules;
}
