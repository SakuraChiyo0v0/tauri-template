import type { ComponentType } from "react";

interface SettingBase {
  id: string;
  label: string;
  description?: string;
  group: string;
  order?: number;
  onChange?: (value: unknown) => void | Promise<void>;
}

export interface SwitchSetting extends SettingBase {
  type: "switch";
  defaultValue: boolean;
}

export interface SelectSetting extends SettingBase {
  type: "select";
  defaultValue: string;
  options: readonly { label: string; value: string }[];
}

export interface CustomSettingProps {
  moduleId: string;
  settingId: string;
}

export interface CustomSetting extends SettingBase {
  type: "custom";
  component: ComponentType<CustomSettingProps>;
}

export type SettingContribution = SwitchSetting | SelectSetting | CustomSetting;

export type ResolvedSetting = SettingContribution & {
  moduleId: string;
  moduleName: string;
};
