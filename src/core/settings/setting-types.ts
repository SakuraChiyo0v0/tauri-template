import type { ComponentType } from "react";
import type { LocalizedText } from "@/core/i18n/localized-text";

interface SettingBase {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
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
  options: readonly { label: LocalizedText; value: string }[];
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

type ResolvedSettingMetadata = {
  label: string;
  description?: string;
  moduleId: string;
  moduleName: string;
};

export type ResolvedSetting =
  | (Omit<SwitchSetting, "label" | "description"> & ResolvedSettingMetadata)
  | (Omit<SelectSetting, "label" | "description" | "options"> & ResolvedSettingMetadata & {
      options: readonly { label: string; value: string }[];
    })
  | (Omit<CustomSetting, "label" | "description"> & ResolvedSettingMetadata);
