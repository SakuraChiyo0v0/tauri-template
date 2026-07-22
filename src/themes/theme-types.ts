import type { LocalizedText } from "@/core/i18n/localized-text";

export type ColorMode = "system" | "light" | "dark";
export type ThemePresetId = "neutral" | "ocean";

export interface ThemeState {
  mode: ColorMode;
  preset: ThemePresetId;
}

export interface ThemePreset {
  id: ThemePresetId;
  name: LocalizedText;
  description: LocalizedText;
  swatch: string;
}
