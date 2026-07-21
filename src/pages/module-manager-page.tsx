import { Boxes, Power } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { featureRegistry } from "@/app/feature-registry";
import { useFeatureStateSnapshot } from "@/core/features/feature-state";

export function ModuleManagerPage() {
  useFeatureStateSnapshot();
  const features = featureRegistry.getManageable();

  return (
    <section>
      <div className="grid gap-4 md:grid-cols-2">
        {features.map((feature) => {
          const enabled = featureRegistry.isEnabled(feature);
          return (
            <Card key={feature.id}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Boxes className="size-4 text-primary" />
                    <CardTitle>{feature.name}</CardTitle>
                    <Badge variant="outline">v{feature.version}</Badge>
                  </div>
                  <CardDescription>{feature.description}</CardDescription>
                  <p className="text-xs text-muted-foreground">{feature.navigation?.length ?? 0} 个页面 · {feature.settings?.length ?? 0} 个设置项</p>
                </div>
                <Switch
                  checked={enabled}
                  disabled={feature.canDisable === false}
                  onCheckedChange={(checked) => void featureRegistry.setEnabled(feature, checked)}
                  aria-label={`${enabled ? "停用" : "启用"}${feature.name}模块`}
                />
              </CardHeader>
              <CardContent className="flex items-center justify-between border-t border-border pt-4 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground"><Power className="size-4" />运行状态</span>
                <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "已启用" : "已停用"}</Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
