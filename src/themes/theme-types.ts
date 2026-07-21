export type ColorMode = "system" | "light" | "dark";
export type ThemePresetId = "neutral" | "ocean";

export interface ThemeState {
  mode: ColorMode;
  preset: ThemePresetId;
}

export interface ThemePreset {
  id: ThemePresetId;
  name: string;
  description: string;
  swatch: string;
}
