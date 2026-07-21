import type { ThemePreset } from "./theme-types";

export const themePresets: readonly ThemePreset[] = [
  {
    id: "neutral",
    name: "中性",
    description: "低饱和度的通用桌面配色",
    swatch: "oklch(0.55 0.02 260)",
  },
  {
    id: "ocean",
    name: "海洋",
    description: "清晰、安静的蓝青色强调色",
    swatch: "oklch(0.58 0.15 235)",
  },
] as const;
