import type { ResolvedSetting } from "@/core/settings/setting-types";
import { isFeatureEnabled, setFeatureEnabled } from "./feature-state";
import type { FeatureModule, RegisteredFeature, ResolvedNavigation } from "./feature-types";

const navigationGroupOrder = { main: 0, system: 1 } as const;

export class FeatureRegistry {
  readonly #features = new Map<string, RegisteredFeature>();
  readonly #listeners = new Set<() => void>();
  #revision = 0;

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.#revision;

  #emit() {
    this.#revision += 1;
    this.#listeners.forEach((listener) => listener());
  }

  register(feature: FeatureModule) {
    if (this.#features.has(feature.id)) throw new Error(`Feature "${feature.id}" is already registered.`);

    const registeredNavigationIds = new Set(this.getAll().flatMap((item) => item.navigation?.map((entry) => entry.id) ?? []));
    const newNavigationIds = feature.navigation?.map((entry) => entry.id) ?? [];
    if (new Set(newNavigationIds).size !== newNavigationIds.length) {
      throw new Error(`Feature "${feature.id}" contains duplicate navigation identifiers.`);
    }
    const duplicateNavigation = feature.navigation?.find((entry) => registeredNavigationIds.has(entry.id));
    if (duplicateNavigation) throw new Error(`Navigation "${duplicateNavigation.id}" is already registered.`);

    const registeredElementNames = new Set(
      this.getAll().flatMap((item) => item.elementNames ?? []),
    );
    const newElementNames = feature.elementNames ?? [];
    if (new Set(newElementNames).size !== newElementNames.length) {
      throw new Error(`Feature "${feature.id}" contains duplicate custom element names.`);
    }
    const duplicateElement = newElementNames.find((elementName) => registeredElementNames.has(elementName));
    if (duplicateElement) throw new Error(`Custom element "${duplicateElement}" is already registered.`);

    this.#features.set(feature.id, { ...feature, source: feature.source ?? "builtin" });
    this.#emit();
    return this;
  }

  unregister(featureId: string) {
    const feature = this.#features.get(featureId);
    if (!feature || feature.source !== "runtime") return false;

    this.#features.delete(featureId);
    try {
      void Promise.resolve(feature.teardown?.()).catch((error) => {
        console.error(`Failed to tear down runtime feature "${featureId}".`, error);
      });
    } catch (error) {
      console.error(`Failed to tear down runtime feature "${featureId}".`, error);
    }
    this.#emit();
    return true;
  }

  getAll() {
    return [...this.#features.values()];
  }

  getManageable() {
    return this.getAll().filter((feature) => !feature.hiddenFromManager);
  }

  isEnabled(feature: FeatureModule) {
    if (feature.source === "runtime" && feature.runtime) {
      return feature.runtime.desiredEnabled && feature.runtime.status === "active";
    }
    return isFeatureEnabled(feature.id, feature.defaultEnabled);
  }

  async setEnabled(feature: FeatureModule, enabled: boolean) {
    if (feature.source === "runtime") {
      throw new Error("运行时模块启停必须通过全局激活计划执行。");
    }
    if (feature.canDisable === false && !enabled) return;
    if (enabled) {
      await feature.setup?.();
      setFeatureEnabled(feature.id, true);
      this.#emit();
      return;
    }

    setFeatureEnabled(feature.id, false);
    this.#emit();
    await feature.teardown?.();
  }

  getNavigation(): ResolvedNavigation[] {
    return this.getAll()
      .filter((feature) => this.isEnabled(feature))
      .flatMap((feature) =>
        (feature.navigation ?? []).map((navigation) => ({
          ...navigation,
          group: navigation.group ?? "main",
          moduleId: feature.id,
          moduleName: feature.name,
        })),
      )
      .sort(
        (left, right) =>
          navigationGroupOrder[left.group ?? "main"] - navigationGroupOrder[right.group ?? "main"] ||
          (left.order ?? 0) - (right.order ?? 0) ||
          left.title.localeCompare(right.title),
      );
  }

  getSettings(): ResolvedSetting[] {
    return this.getAll()
      .filter((feature) => this.isEnabled(feature))
      .flatMap((feature) =>
        (feature.settings ?? []).map((setting) => ({
          ...setting,
          moduleId: feature.id,
          moduleName: feature.name,
        })),
      )
      .sort((left, right) => left.group.localeCompare(right.group) || (left.order ?? 0) - (right.order ?? 0));
  }

  async initialize() {
    await Promise.all(
      this.getAll()
        .filter((feature) => this.isEnabled(feature))
        .map((feature) => feature.setup?.()),
    );
  }
}
