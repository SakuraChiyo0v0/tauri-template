import type { ResolvedSetting } from "@/core/settings/setting-types";
import { isFeatureEnabled, setFeatureEnabled } from "./feature-state";
import type { FeatureModule, ResolvedNavigation } from "./feature-types";

const navigationGroupOrder = { main: 0, system: 1 } as const;

export class FeatureRegistry {
  readonly #features = new Map<string, FeatureModule>();

  register(feature: FeatureModule) {
    if (this.#features.has(feature.id)) throw new Error(`Feature "${feature.id}" is already registered.`);

    const registeredNavigationIds = new Set(this.getAll().flatMap((item) => item.navigation?.map((entry) => entry.id) ?? []));
    const newNavigationIds = feature.navigation?.map((entry) => entry.id) ?? [];
    if (new Set(newNavigationIds).size !== newNavigationIds.length) {
      throw new Error(`Feature "${feature.id}" contains duplicate navigation identifiers.`);
    }
    const duplicateNavigation = feature.navigation?.find((entry) => registeredNavigationIds.has(entry.id));
    if (duplicateNavigation) throw new Error(`Navigation "${duplicateNavigation.id}" is already registered.`);

    this.#features.set(feature.id, feature);
    return this;
  }

  getAll() {
    return [...this.#features.values()];
  }

  getManageable() {
    return this.getAll().filter((feature) => !feature.hiddenFromManager);
  }

  isEnabled(feature: FeatureModule) {
    return isFeatureEnabled(feature.id, feature.defaultEnabled);
  }

  async setEnabled(feature: FeatureModule, enabled: boolean) {
    if (feature.canDisable === false && !enabled) return;
    setFeatureEnabled(feature.id, enabled);
    if (enabled) await feature.setup?.();
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
