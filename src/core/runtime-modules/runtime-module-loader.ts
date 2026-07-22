import { Puzzle } from "lucide-react";
import type { FeatureRegistry } from "@/core/features/feature-registry";
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
  if (manifest.id !== module.manifest.id || manifest.version !== module.activeVersion) {
    throw new Error(`模块入口身份不匹配：期望 ${module.manifest.id}@${module.activeVersion}。`);
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
    defaultEnabled: true,
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
    version: module.activeVersion,
    defaultEnabled: true,
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
) {
  registry.unregister(module.manifest.id);
  const result = await dependencies.backend.reportActivationFailure(
    module.manifest.id,
    module.activeVersion,
    errorMessage(error),
  );

  try {
    registry.register(createDiagnosticFeature(result.module));
  } catch (registrationError) {
    console.error(`无法注册模块 ${module.manifest.id} 的诊断信息。`, registrationError);
  }

  if (result.rolledBack && dependencies.recoveryState.get(module.manifest.id) === null) {
    dependencies.recoveryState.set(module.manifest.id, module.activeVersion);
    dependencies.reload();
  }
}

export async function discoverRuntimeModules(
  registry: FeatureRegistry,
  dependencies = createDefaultRuntimeModuleLoaderDependencies(),
) {
  const modules = await dependencies.backend.list();

  for (const module of modules) {
    if (module.blockedVersion === module.activeVersion) {
      registry.register(createDiagnosticFeature(module));
      continue;
    }

    const feature = createRuntimeFeature(module, () => activateRuntimeModule(module, dependencies));
    try {
      registry.register(feature);
      if (registry.isEnabled(feature)) await feature.setup?.();
    } catch (error) {
      try {
        await reportFailure(module, error, registry, dependencies);
      } catch (reportError) {
        console.error(`无法记录模块 ${module.manifest.id} 的激活失败。`, reportError);
      }
    }
  }

  return modules;
}
