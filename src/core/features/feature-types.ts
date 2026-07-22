import type { ComponentType } from "react";
import type { SettingContribution } from "@/core/settings/setting-types";
import type { InstalledRuntimeModule } from "@/core/runtime-modules/runtime-module-types";
import type { LocalizedText } from "@/core/i18n/localized-text";

export type NavigationGroup = "main" | "system";
export type FeatureSource = "builtin" | "runtime";

export interface NavigationIconProps {
  className?: string;
}

export interface NavigationContribution {
  id: string;
  title: LocalizedText;
  description?: LocalizedText;
  icon: ComponentType<NavigationIconProps>;
  component: ComponentType;
  group?: NavigationGroup;
  order?: number;
}

export type ResolvedNavigation = Omit<NavigationContribution, "title" | "description"> & {
  title: string;
  description?: string;
  moduleId: string;
  moduleName: string;
};

export interface FeatureModule {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  version: string;
  defaultEnabled: boolean;
  canDisable?: boolean;
  hiddenFromManager?: boolean;
  source?: FeatureSource;
  runtime?: InstalledRuntimeModule;
  elementNames?: readonly string[];
  navigation?: readonly NavigationContribution[];
  settings?: readonly SettingContribution[];
  setup?: () => void | Promise<void>;
  teardown?: () => void | Promise<void>;
}

export type RegisteredFeature = FeatureModule & {
  source: FeatureSource;
};

export function defineFeature<const T extends FeatureModule>(feature: T): T {
  return feature;
}
