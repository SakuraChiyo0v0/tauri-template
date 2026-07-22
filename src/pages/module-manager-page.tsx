import { useState, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, Boxes, PackagePlus, Power, RotateCcw, Trash2 } from "lucide-react";
import { featureRegistry } from "@/app/feature-registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { runtimeModuleApi } from "@/core/runtime-modules/runtime-module-api";
import { getModuleManagementState } from "@/core/runtime-modules/runtime-module-management";

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ModuleManagerPage() {
  useSyncExternalStore(featureRegistry.subscribe, featureRegistry.getSnapshot, featureRegistry.getSnapshot);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const features = featureRegistry.getManageable();

  const runReloadingAction = async (actionId: string, action: () => Promise<unknown>) => {
    setBusyAction(actionId);
    setFeedback(null);
    try {
      await action();
      location.reload();
    } catch (error) {
      setFeedback(messageOf(error));
      setBusyAction(null);
    }
  };

  const installPackage = async () => {
    if (!isTauri()) {
      setFeedback("安装模块需要在 Tauri 桌面应用中执行，浏览器预览不会伪造安装结果。");
      return;
    }

    try {
      const packagePath = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Modular Tauri Package", extensions: ["mtp"] }],
      });
      if (typeof packagePath !== "string") return;
      await runReloadingAction("install", () => runtimeModuleApi.install(packagePath));
    } catch (error) {
      setFeedback(messageOf(error));
      setBusyAction(null);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="font-semibold">功能模块</h2>
          <p className="mt-1 text-sm text-muted-foreground">本地 `.mtp` 包可独立安装、升级、回滚和卸载。</p>
        </div>
        <Button onClick={() => void installPackage()} disabled={busyAction !== null}>
          <PackagePlus className="size-4" />{busyAction === "install" ? "安装中…" : "安装或升级模块"}
        </Button>
      </div>

      {feedback && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />{feedback}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {features.map((feature) => {
          const enabled = featureRegistry.isEnabled(feature);
          const state = getModuleManagementState(feature, enabled);
          const runtime = feature.runtime;
          const isBusy = busyAction?.endsWith(`:${feature.id}`) ?? false;

          return (
            <Card key={feature.id}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Boxes className="size-4 text-primary" />
                    <CardTitle>{feature.name}</CardTitle>
                    <Badge variant="outline">v{state.version}</Badge>
                    <Badge variant="secondary">{state.sourceLabel}</Badge>
                  </div>
                  <CardDescription>{feature.description}</CardDescription>
                  <p className="text-xs text-muted-foreground">
                    {feature.navigation?.length ?? 0} 个页面 · {feature.settings?.length ?? 0} 个设置项 · {feature.id}
                  </p>
                </div>
                <Switch
                  checked={state.status === "active"}
                  disabled={!state.canToggle || busyAction !== null}
                  onCheckedChange={(checked) => {
                    setFeedback(null);
                    void featureRegistry.setEnabled(feature, checked).catch((error) => setFeedback(messageOf(error)));
                  }}
                  aria-label={`${enabled ? "停用" : "启用"}${feature.name}模块`}
                />
              </CardHeader>

              {state.error && (
                <div className="mx-5 mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>v{runtime?.lastError?.version}：{state.error}</span>
                </div>
              )}

              <CardContent className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Power className="size-4" />运行状态
                  <Badge
                    variant={state.status === "active" ? "default" : "secondary"}
                    className={state.status === "failed" ? "bg-destructive text-white" : undefined}
                  >
                    {state.statusLabel}
                  </Badge>
                </span>

                {runtime && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!state.canRollback || busyAction !== null}
                      onClick={() => {
                        if (!confirm(`将 ${feature.name} 回滚到 v${runtime.previousVersion}？`)) return;
                        void runReloadingAction(`rollback:${feature.id}`, () => runtimeModuleApi.rollback(feature.id));
                      }}
                    >
                      <RotateCcw className="size-3.5" />{isBusy && busyAction?.startsWith("rollback") ? "回滚中…" : "回滚"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!state.canUninstall || busyAction !== null}
                      onClick={() => {
                        if (!confirm(`确定卸载 ${feature.name}？模块文件会从本机删除。`)) return;
                        void runReloadingAction(`uninstall:${feature.id}`, () => runtimeModuleApi.uninstall(feature.id));
                      }}
                    >
                      <Trash2 className="size-3.5" />{isBusy && busyAction?.startsWith("uninstall") ? "卸载中…" : "卸载"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
