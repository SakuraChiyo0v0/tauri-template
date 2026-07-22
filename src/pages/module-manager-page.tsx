import { useEffect, useState, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, Boxes, Database, FolderKey, Keyboard, PackagePlus, Power, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { featureRegistry } from "@/app/feature-registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { runtimeModuleApi } from "@/core/runtime-modules/runtime-module-api";
import { canClearModuleData, formatModuleDataSize, orphanedModuleData } from "@/core/runtime-modules/runtime-module-data";
import { getModuleManagementState } from "@/core/runtime-modules/runtime-module-management";
import type {
  ModuleDataInventoryItem,
  RuntimeFileGrant,
  RuntimeModuleOperationResult,
  RuntimeShortcutStatus,
} from "@/core/runtime-modules/runtime-module-types";

function messageOf(error: unknown) {
  if (error && typeof error === "object" && "kind" in error) {
    const value = error as { kind?: string; message?: string; impact?: { code?: string; relatedModules?: string[] } };
    if (value.kind === "message" && value.message) return value.message;
    if (value.kind === "dependency_impact" && value.impact) {
      const modules = value.impact.relatedModules?.join("、") || "其他模块";
      if (value.impact.code === "required_by_enabled_modules") return `无法停用：${modules} 仍在依赖此模块。`;
      if (value.impact.code === "required_by_installed_modules") return `无法卸载：${modules} 仍声明了对此模块的必需依赖。`;
      if (value.impact.code === "rollback_requires_coordinated_change") return `无法单独回滚：还需要同时变更 ${modules}。`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export function ModuleManagerPage() {
  useSyncExternalStore(featureRegistry.subscribe, featureRegistry.getSnapshot, featureRegistry.getSnapshot);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [moduleData, setModuleData] = useState<ModuleDataInventoryItem[]>([]);
  const [grantsByModule, setGrantsByModule] = useState<Record<string, RuntimeFileGrant[]>>({});
  const [shortcutsByModule, setShortcutsByModule] = useState<Record<string, RuntimeShortcutStatus[]>>({});
  const features = featureRegistry.getManageable();
  const runtimeFeatureIds = new Set(features.filter((feature) => feature.runtime).map((feature) => feature.id));
  const dataByModule = new Map(moduleData.map((item) => [item.moduleId, item]));
  const orphanedData = orphanedModuleData(moduleData, runtimeFeatureIds);

  useEffect(() => {
    void runtimeModuleApi.listData()
      .then(setModuleData)
      .catch((error) => setFeedback(messageOf(error)));
  }, []);

  useEffect(() => {
    const modules = featureRegistry.getManageable()
      .filter((feature) => feature.runtime?.permissionStatus === "approved" && feature.runtime.status === "active");
    void Promise.all(modules.map(async (feature) => {
      const [grants, shortcuts] = await Promise.all([
        runtimeModuleApi.listFileGrants(feature.id).catch(() => []),
        runtimeModuleApi.listShortcuts(feature.id).catch(() => []),
      ]);
      return [feature.id, grants, shortcuts] as const;
    })).then((details) => {
      setGrantsByModule(Object.fromEntries(details.map(([id, grants]) => [id, grants])));
      setShortcutsByModule(Object.fromEntries(details.map(([id, , shortcuts]) => [id, shortcuts])));
    });
  }, []);

  const runReloadingAction = async (actionId: string, action: () => Promise<RuntimeModuleOperationResult>) => {
    setBusyAction(actionId);
    setFeedback(null);
    try {
      const result = await action();
      if (result.planChanged || result.packageInstalled) {
        location.reload();
        return;
      }
      setFeedback(result.packageInstalled ? "模块版本已安装，但当前兼容激活组合没有变化。" : "当前激活计划没有变化。");
      setBusyAction(null);
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

  const clearModuleData = async (moduleId: string) => {
    if (!confirm(`确定清除 ${moduleId} 的全部数据库数据？此操作无法撤销。`)) return;
    setBusyAction(`clear-data:${moduleId}`);
    setFeedback(null);
    try {
      setModuleData(await runtimeModuleApi.clearData(moduleId));
      setFeedback(`已清除 ${moduleId} 的数据库数据。`);
    } catch (error) {
      setFeedback(messageOf(error));
    } finally {
      setBusyAction(null);
    }
  };

  const createFileGrant = async (moduleId: string, kind: RuntimeFileGrant["kind"]) => {
    if (!isTauri()) return setFeedback("文件授权只能在 Tauri 桌面应用中执行。");
    const runtime = featureRegistry.getAll().find((feature) => feature.id === moduleId)?.runtime;
    const capabilities = runtime?.manifest.nativeCapabilities;
    const external = capabilities?.filesystem?.external ?? [];
    const path = await open({ multiple: false, directory: kind === "directory" });
    if (typeof path !== "string") return;
    const access = kind === "executable"
      ? { read: false, write: false, list: false, execute: true }
      : kind === "directory"
        ? { read: external.includes("read"), write: false, list: true, execute: false }
        : { read: external.includes("read"), write: external.includes("write"), list: false, execute: false };
    setBusyAction(`grant:${moduleId}`);
    try {
      await runtimeModuleApi.createFileGrant(moduleId, path, kind, access);
      const grants = await runtimeModuleApi.listFileGrants(moduleId);
      setGrantsByModule((current) => ({ ...current, [moduleId]: grants }));
      setFeedback("文件授权已保存，模块只会收到不透明授权编号。");
    } catch (error) {
      setFeedback(messageOf(error));
    } finally {
      setBusyAction(null);
    }
  };

  const revokeFileGrant = async (moduleId: string, grantId: string) => {
    setBusyAction(`grant:${moduleId}`);
    try {
      await runtimeModuleApi.revokeFileGrant(moduleId, grantId);
      setGrantsByModule((current) => ({
        ...current,
        [moduleId]: (current[moduleId] ?? []).filter((grant) => grant.id !== grantId),
      }));
    } catch (error) {
      setFeedback(messageOf(error));
    } finally {
      setBusyAction(null);
    }
  };

  const rebindShortcut = async (moduleId: string, shortcut: RuntimeShortcutStatus) => {
    const accelerator = prompt("输入新的全局快捷键，例如 Ctrl+Shift+Y", shortcut.accelerator ?? "");
    if (!accelerator) return;
    try {
      const shortcuts = await runtimeModuleApi.rebindShortcut(moduleId, shortcut.shortcutId, accelerator);
      setShortcutsByModule((current) => ({ ...current, [moduleId]: shortcuts }));
      setFeedback("快捷键已重新绑定。");
    } catch (error) {
      setFeedback(messageOf(error));
    }
  };

  const disableShortcut = async (moduleId: string, shortcutId: string) => {
    try {
      const shortcuts = await runtimeModuleApi.disableShortcut(moduleId, shortcutId);
      setShortcutsByModule((current) => ({ ...current, [moduleId]: shortcuts }));
      setFeedback("快捷键已禁用。");
    } catch (error) {
      setFeedback(messageOf(error));
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
          const data = dataByModule.get(feature.id);
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
                  {runtime && (
                    <p className="text-xs text-muted-foreground">
                      已选择 {runtime.selectedVersion ? `v${runtime.selectedVersion}` : "无"} · 已安装 {state.availableVersions.map((version) => `v${version}`).join("、")}
                    </p>
                  )}
                  {runtime && data && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Database className="size-3.5" />数据库占用 {formatModuleDataSize(data.sizeBytes)}
                    </p>
                  )}
                </div>
                <Switch
                  checked={state.toggleChecked}
                  disabled={!state.canToggle || busyAction !== null}
                  onCheckedChange={(checked) => {
                    setFeedback(null);
                    if (runtime) {
                      void runReloadingAction(`toggle:${feature.id}`, () => runtimeModuleApi.setEnabled(feature.id, checked));
                    } else {
                      void featureRegistry.setEnabled(feature, checked).catch((error) => setFeedback(messageOf(error)));
                    }
                  }}
                  aria-label={`${state.toggleChecked ? "停用" : "启用"}${feature.name}模块`}
                />
              </CardHeader>

              {state.error && (
                <div className="mx-5 mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>v{runtime?.lastError?.version}：{state.error}</span>
                </div>
              )}

              {state.diagnosticMessages.length > 0 && (
                <div className="mx-5 mb-4 space-y-1 rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                  {state.diagnosticMessages.map((message) => <p key={message}>{message}</p>)}
                </div>
              )}

              {runtime && (state.requiredDependencies.length > 0 || state.optionalDependencies.length > 0 || state.dependents.length > 0) && (
                <div className="mx-5 mb-4 grid gap-2 rounded-lg border border-border p-3 text-xs sm:grid-cols-3">
                  <div><span className="text-muted-foreground">必需依赖</span><p className="mt-1 break-words">{state.requiredDependencies.join("、") || "无"}</p></div>
                  <div><span className="text-muted-foreground">可选依赖</span><p className="mt-1 break-words">{state.optionalDependencies.join("、") || "无"}</p></div>
                  <div><span className="text-muted-foreground">依赖者</span><p className="mt-1 break-words">{state.dependents.join("、") || "无"}</p></div>
                </div>
              )}

              {runtime && (runtime.manifest.sdkVersion === 3 || runtime.permissionStatus !== "not_required") && (
                <div className="mx-5 mb-4 space-y-3 rounded-lg border border-border p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 font-medium"><ShieldCheck className="size-4 text-primary" />原生能力</p>
                    <div className="flex gap-2">
                      {state.canApprovePermissions && state.permissionVersion && (
                        <Button
                          size="sm"
                          disabled={busyAction !== null}
                          onClick={() => {
                            if (!confirm(`批准 ${feature.name} v${state.permissionVersion} 请求的原生能力？`)) return;
                            void runReloadingAction(`approve:${feature.id}`, () => runtimeModuleApi.approveNativePermissions(feature.id, state.permissionVersion as string));
                          }}
                        >批准并启用</Button>
                      )}
                      {state.canRevokePermissions && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyAction !== null}
                          onClick={() => {
                            if (!confirm(`撤销 ${feature.name} 的全部原生能力？模块会停止运行。`)) return;
                            void runReloadingAction(`revoke:${feature.id}`, () => runtimeModuleApi.revokeNativePermissions(feature.id));
                          }}
                        >撤销权限</Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1 text-muted-foreground">
                    {state.permissionSummary.length > 0
                      ? state.permissionSummary.map((line) => <p key={line}>· {line}</p>)
                      : <p>此模块没有声明原生能力。</p>}
                  </div>

                  {state.canRevokePermissions && (
                    <div className="space-y-2 border-t border-border pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <FolderKey className="size-4 text-primary" />
                        {runtime.manifest.nativeCapabilities?.filesystem?.external.some((access) => access === "read" || access === "write") && (
                          <Button variant="outline" size="sm" onClick={() => void createFileGrant(feature.id, "file")}>授权文件</Button>
                        )}
                        {runtime.manifest.nativeCapabilities?.filesystem?.external.includes("list") && (
                          <Button variant="outline" size="sm" onClick={() => void createFileGrant(feature.id, "directory")}>授权目录</Button>
                        )}
                        {runtime.manifest.nativeCapabilities?.process?.executableGrants && (
                          <Button variant="outline" size="sm" onClick={() => void createFileGrant(feature.id, "executable")}>授权程序</Button>
                        )}
                      </div>
                      {(grantsByModule[feature.id] ?? []).map((grant) => (
                        <div key={grant.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                          <span>{grant.displayName} · {grant.kind}</span>
                          <Button variant="ghost" size="sm" onClick={() => void revokeFileGrant(feature.id, grant.id)}>撤销</Button>
                        </div>
                      ))}
                      {(shortcutsByModule[feature.id] ?? []).length > 0 && (
                        <div className="space-y-1 border-t border-border pt-2">
                          <p className="flex items-center gap-1.5 font-medium"><Keyboard className="size-4 text-primary" />全局快捷键</p>
                          {(shortcutsByModule[feature.id] ?? []).map((shortcut) => (
                            <div key={shortcut.shortcutId} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                              <span>{shortcut.shortcutId} · {shortcut.accelerator ?? "已禁用"} · {shortcut.state === "conflict" ? "冲突" : shortcut.state === "registered" ? "已注册" : "已禁用"}</span>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => void rebindShortcut(feature.id, shortcut)}>重新绑定</Button>
                                {shortcut.state !== "disabled" && (
                                  <Button variant="ghost" size="sm" onClick={() => void disableShortcut(feature.id, shortcut.shortcutId)}>禁用</Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <CardContent className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Power className="size-4" />运行状态
                  <Badge
                    variant={state.status === "active" ? "default" : "secondary"}
                    className={state.status === "blocked" ? "bg-destructive text-white" : undefined}
                  >
                    {state.statusLabel}
                  </Badge>
                </span>

                {runtime && (
                  <div className="flex items-center gap-2">
                    {data && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canClearModuleData(state.status, true) || busyAction !== null}
                        title={state.status === "active" ? "请先停用模块再清除数据" : undefined}
                        onClick={() => void clearModuleData(feature.id)}
                      >
                        <Database className="size-3.5" />{isBusy && busyAction?.startsWith("clear-data") ? "清除中…" : "清除数据"}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!state.canRollback || busyAction !== null}
                      onClick={() => {
                        if (!confirm(`将 ${feature.name} 回滚到 v${runtime.previousSelectedVersion}？`)) return;
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

      {orphanedData.length > 0 && (
        <section className="space-y-3">
          <div>
            <h3 className="font-semibold">保留的模块数据</h3>
            <p className="mt-1 text-sm text-muted-foreground">模块卸载后数据库默认保留，重新安装可继续使用。</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {orphanedData.map((data) => (
              <Card key={data.moduleId}>
                <CardContent className="flex items-center justify-between gap-3 pt-5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium"><Database className="size-4 text-primary" />{data.moduleId}</p>
                    <p className="mt-1 text-xs text-muted-foreground">数据库占用 {formatModuleDataSize(data.sizeBytes)}</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busyAction !== null}
                    onClick={() => void clearModuleData(data.moduleId)}
                  >
                    <Trash2 className="size-3.5" />{busyAction === `clear-data:${data.moduleId}` ? "清除中…" : "清除数据"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
