import type { SettingContribution } from "@/core/settings/setting-types";

export interface FeatureModule {
  id: string;
  name: string;
  description: string;
  version: string;
  defaultEnabled: boolean;
  canDisable?: boolean;
  settings?: readonly SettingContribution[];
  setup?: () => void | Promise<void>;
}

export function defineFeature<const T extends FeatureModule>(feature: T): T {
  return feature;
}
