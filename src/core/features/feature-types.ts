import type { ComponentType } from "react";
import type { SettingContribution } from "@/core/settings/setting-types";

export type NavigationGroup = "main" | "system";

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
  navigation?: readonly NavigationContribution[];
  settings?: readonly SettingContribution[];
  setup?: () => void | Promise<void>;
}

export function defineFeature<const T extends FeatureModule>(feature: T): T {
  return feature;
}
