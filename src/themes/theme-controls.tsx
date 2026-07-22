import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resolveLocalizedText } from "@/core/i18n/localized-text";
import { useI18n } from "@/core/i18n/use-i18n";
import { themePresets } from "./theme-registry";
import { useTheme } from "./theme-store";
import type { ColorMode, ThemePresetId } from "./theme-types";

const modeOptions = [
  { value: "system", label: "theme.mode.system", icon: Monitor },
  { value: "light", label: "theme.mode.light", icon: Sun },
  { value: "dark", label: "theme.mode.dark", icon: Moon },
] as const;

export function ThemeControls() {
  const theme = useTheme();
  const { locale, t } = useI18n();

  return (
    <div className="flex items-center gap-2">
      <Select value={theme.preset} onValueChange={(value) => theme.setThemePreset(value as ThemePresetId)}>
        <SelectTrigger className="w-32" aria-label={t("theme.preset")}>
          <Palette className="size-4 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {themePresets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{resolveLocalizedText(preset.name, locale)}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={theme.mode} onValueChange={(value) => theme.setColorMode(value as ColorMode)}>
        <SelectTrigger className="w-36" aria-label={t("theme.mode")}><SelectValue /></SelectTrigger>
        <SelectContent>
          {modeOptions.map(({ value, label, icon: Icon }) => (
            <SelectItem key={value} value={value}><span className="flex items-center gap-2"><Icon className="size-4" />{t(label)}</span></SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
