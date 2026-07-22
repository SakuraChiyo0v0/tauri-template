import type { ComponentType } from "react";
import type { SettingContribution } from "@/core/settings/setting-types";
import type { InstalledRuntimeModule } from "@/core/runtime-modules/runtime-module-types";

export type NavigationGroup = "main" | "system";
export type FeatureSource = "builtin" | "runtime";

export interface NavigationIconProps {
  className?: string;
}

export interface NavigationContribution {
  id: string;
  title: string;
  description?: string;
  icon: ComponentType<NavigationIconProps>;
  component: ComponentType;
  group?: NavigationGroup;
  order?: number;
}

export type ResolvedNavigation = NavigationContribution & {
  moduleId: string;
  moduleName: string;
};

export interface FeatureModule {
  id: string;
  name: string;
  description: string;
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
