import type { ResolvedSetting } from "@/core/settings/setting-types";
import { isFeatureEnabled, setFeatureEnabled } from "./feature-state";
import type { FeatureModule } from "./feature-types";

export class FeatureRegistry {
  readonly #features = new Map<string, FeatureModule>();

  register(feature: FeatureModule) {
    if (this.#features.has(feature.id)) throw new Error(`Feature "${feature.id}" is already registered.`);
    this.#features.set(feature.id, feature);
    return this;
  }

  getAll() {
    return [...this.#features.values()];
  }

  isEnabled(feature: FeatureModule) {
    return isFeatureEnabled(feature.id, feature.defaultEnabled);
  }

  async setEnabled(feature: FeatureModule, enabled: boolean) {
    if (feature.canDisable === false && !enabled) return;
    setFeatureEnabled(feature.id, enabled);
    if (enabled) await feature.setup?.();
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
