import type { ThemePreset } from "./theme-types";

export const themePresets: readonly ThemePreset[] = [
  {
    id: "neutral",
    name: { "zh-CN": "中性", en: "Neutral" },
    description: { "zh-CN": "低饱和度的通用桌面配色", en: "A low-saturation general desktop palette" },
    swatch: "oklch(0.55 0.02 260)",
  },
  {
    id: "ocean",
    name: { "zh-CN": "海洋", en: "Ocean" },
    description: { "zh-CN": "清晰、安静的蓝青色强调色", en: "A clear and calm blue-cyan accent palette" },
    swatch: "oklch(0.58 0.15 235)",
  },
] as const;
