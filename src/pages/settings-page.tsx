import { Languages, Palette, SlidersHorizontal } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { featureRegistry } from "@/app/feature-registry";
import { useFeatureStateSnapshot } from "@/core/features/feature-state";
import { useSetting } from "@/core/settings/setting-store";
import type { ResolvedSetting } from "@/core/settings/setting-types";
import { useI18n } from "@/core/i18n/use-i18n";
import type { MessageKey } from "@/core/i18n/messages";
import type { SupportedLocale } from "@/core/i18n/locale-store";
import { ThemeControls } from "@/themes/theme-controls";

const groupLabels: Record<string, MessageKey> = {
  general: "settings.group.general",
  appearance: "settings.group.appearance",
  features: "settings.group.features",
  diagnostics: "settings.group.diagnostics",
  advanced: "settings.group.advanced",
};

function SettingField({ setting }: { setting: ResolvedSetting }) {
  if (setting.type === "custom") {
    const Component = setting.component;
    return <Component moduleId={setting.moduleId} settingId={setting.id} />;
  }

  if (setting.type === "switch") {
    return <SwitchSettingField setting={setting} />;
  }

  return <SelectSettingField setting={setting} />;
}

function SwitchSettingField({ setting }: { setting: Extract<ResolvedSetting, { type: "switch" }> }) {
  const [value, setValue] = useSetting(setting.moduleId, setting.id, setting.defaultValue);
  const update = (nextValue: boolean) => {
    setValue(nextValue);
    void setting.onChange?.(nextValue);
  };

  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="space-y-1">
        <Label htmlFor={`${setting.moduleId}-${setting.id}`}>{setting.label}</Label>
        {setting.description && <p className="text-sm text-muted-foreground">{setting.description}</p>}
      </div>
      <Switch id={`${setting.moduleId}-${setting.id}`} checked={value} onCheckedChange={update} />
    </div>
  );
}

function SelectSettingField({ setting }: { setting: Extract<ResolvedSetting, { type: "select" }> }) {
  const [value, setValue] = useSetting(setting.moduleId, setting.id, setting.defaultValue);
  const update = (nextValue: string) => {
    setValue(nextValue);
    void setting.onChange?.(nextValue);
  };

  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="space-y-1">
        <Label htmlFor={`${setting.moduleId}-${setting.id}`}>{setting.label}</Label>
        {setting.description && <p className="text-sm text-muted-foreground">{setting.description}</p>}
      </div>
      <Select value={value} onValueChange={update}>
        <SelectTrigger id={`${setting.moduleId}-${setting.id}`} className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          {setting.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SettingsPage() {
  const { locale, setLocale, t } = useI18n();
  useFeatureStateSnapshot();
  const settings = featureRegistry.getSettings(locale);
  const groups = settings.reduce<Map<string, ResolvedSetting[]>>((result, setting) => {
    result.set(setting.group, [...(result.get(setting.group) ?? []), setting]);
    return result;
  }, new Map());

  return (
    <section className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><Languages className="size-4 text-primary" /><CardTitle>{t("settings.languageTitle")}</CardTitle></div>
          <CardDescription>{t("settings.languageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-6 py-1">
            <div className="space-y-1">
              <Label htmlFor="application-locale">{t("settings.languageLabel")}</Label>
              <p className="text-sm text-muted-foreground">{t("settings.languageHint")}</p>
            </div>
            <Select value={locale} onValueChange={(value) => setLocale(value as SupportedLocale)}>
              <SelectTrigger id="application-locale" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN">{t("settings.languageChinese")}</SelectItem>
                <SelectItem value="en">{t("settings.languageEnglish")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><Palette className="size-4 text-primary" /><CardTitle>{t("settings.appearance")}</CardTitle></div>
          <CardDescription>{t("settings.appearanceDescription")}</CardDescription>
        </CardHeader>
        <CardContent><ThemeControls /></CardContent>
      </Card>

      {[...groups.entries()].map(([group, contributions]) => (
        <Card key={group}>
          <CardHeader>
            <div className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-primary" /><CardTitle>{groupLabels[group] ? t(groupLabels[group]) : contributions[0]?.moduleName ?? group}</CardTitle></div>
            <CardDescription>{t("settings.providerCount", { count: new Set(contributions.map((item) => item.moduleName)).size })}</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {contributions.map((setting) => <SettingField key={`${setting.moduleId}:${setting.id}`} setting={setting} />)}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
