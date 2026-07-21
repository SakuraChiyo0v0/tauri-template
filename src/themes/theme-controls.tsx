import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { themePresets } from "./theme-registry";
import { useTheme } from "./theme-store";
import type { ColorMode, ThemePresetId } from "./theme-types";

const modeOptions = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
] as const;

export function ThemeControls() {
  const theme = useTheme();

  return (
    <div className="flex items-center gap-2">
      <Select value={theme.preset} onValueChange={(value) => theme.setThemePreset(value as ThemePresetId)}>
        <SelectTrigger className="w-32" aria-label="配色主题">
          <Palette className="size-4 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {themePresets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={theme.mode} onValueChange={(value) => theme.setColorMode(value as ColorMode)}>
        <SelectTrigger className="w-36" aria-label="显示模式"><SelectValue /></SelectTrigger>
        <SelectContent>
          {modeOptions.map(({ value, label, icon: Icon }) => (
            <SelectItem key={value} value={value}><span className="flex items-center gap-2"><Icon className="size-4" />{label}</span></SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
