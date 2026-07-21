import { Palette, SlidersHorizontal } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { featureRegistry } from "@/app/module-registry";
import { useFeatureStateSnapshot } from "@/core/features/feature-state";
import { useSetting } from "@/core/settings/setting-store";
import type { ResolvedSetting } from "@/core/settings/setting-types";
import { ThemeControls } from "@/themes/theme-controls";

const groupLabels: Record<string, string> = {
  general: "常规",
  appearance: "外观",
  features: "功能",
  diagnostics: "诊断",
  advanced: "高级",
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
  useFeatureStateSnapshot();
  const settings = featureRegistry.getSettings();
  const groups = settings.reduce<Map<string, ResolvedSetting[]>>((result, setting) => {
    result.set(setting.group, [...(result.get(setting.group) ?? []), setting]);
    return result;
  }, new Map());

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">设置</h2>
        <p className="mt-1 text-sm text-muted-foreground">页面只负责呈现；模块通过清单贡献自己的设置项。</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><Palette className="size-4 text-primary" /><CardTitle>外观</CardTitle></div>
          <CardDescription>显示模式和配色预设会同步到所有语义化组件。</CardDescription>
        </CardHeader>
        <CardContent><ThemeControls /></CardContent>
      </Card>

      {[...groups.entries()].map(([group, contributions]) => (
        <Card key={group}>
          <CardHeader>
            <div className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-primary" /><CardTitle>{groupLabels[group] ?? group}</CardTitle></div>
            <CardDescription>由 {new Set(contributions.map((item) => item.moduleName)).size} 个已启用模块提供</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {contributions.map((setting) => <SettingField key={`${setting.moduleId}:${setting.id}`} setting={setting} />)}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
