import { useEffect, useState, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, Boxes, Database, FolderKey, Keyboard, PackagePlus, Power, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { featureRegistry } from "@/app/feature-registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { resolveLocalizedText } from "@/core/i18n/localized-text";
import type { SupportedLocale } from "@/core/i18n/locale-store";
import { translate } from "@/core/i18n/messages";
import { useI18n } from "@/core/i18n/use-i18n";
import { runtimeModuleApi } from "@/core/runtime-modules/runtime-module-api";
import { canClearModuleData, formatModuleDataSize, orphanedModuleData } from "@/core/runtime-modules/runtime-module-data";
import { getModuleManagementState } from "@/core/runtime-modules/runtime-module-management";
import { ShortcutRecorderDialog } from "./shortcut-recorder-dialog";
import type {
  ModuleDataInventoryItem,
  NativePermissionSummary,
  RuntimeFileGrant,
  RuntimeModuleOperationResult,
  RuntimeShortcutStatus,
} from "@/core/runtime-modules/runtime-module-types";

function formatPermissionSummary(item: NativePermissionSummary, locale: SupportedLocale) {
  const separator = locale === "zh-CN" ? "、" : ", ";
  const accessLabel = (access: string) => translate(locale, access === "write"
    ? "modules.permission.access.write"
    : access === "list"
      ? "modules.permission.access.list"
      : "modules.permission.access.read");
  if (item.kind === "private_filesystem") return translate(locale, "modules.permission.privateFilesystem");
  if (item.kind === "external_filesystem") return translate(locale, "modules.permission.externalFilesystem", { access: item.access.map(accessLabel).join(separator) });
  if (item.kind === "url_schemes") return translate(locale, "modules.permission.urlSchemes", { schemes: item.schemes.join(separator) });
  if (item.kind === "executable_grants") return translate(locale, "modules.permission.executableGrants");
  if (item.kind === "registry") return translate(locale, "modules.permission.registry", {
    scope: `${item.hive}\\${item.key} (${translate(locale, item.access === "read_write" ? "modules.permission.access.readWrite" : "modules.permission.access.read")})`,
  });
  if (item.kind === "tray") return translate(locale, "modules.permission.tray", { count: item.count });
  if (item.kind === "shortcuts") return translate(locale, "modules.permission.shortcuts", { count: item.count });
  return translate(locale, "modules.permission.moduleRepositoryInstall");
}

function messageOf(error: unknown, locale: SupportedLocale) {
  if (error && typeof error === "object" && "kind" in error) {
    const value = error as { kind?: string; message?: string; impact?: { code?: string; relatedModules?: string[] } };
    if (value.kind === "message" && value.message) return value.message;
    if (value.kind === "dependency_impact" && value.impact) {
      const modules = value.impact.relatedModules?.join(locale === "zh-CN" ? "、" : ", ") || translate(locale, "modules.otherModules");
      if (value.impact.code === "required_by_enabled_modules") return translate(locale, "modules.error.requiredEnabled", { modules });
      if (value.impact.code === "required_by_installed_modules") return translate(locale, "modules.error.requiredInstalled", { modules });
      if (value.impact.code === "rollback_requires_coordinated_change") return translate(locale, "modules.error.rollbackCoordinated", { modules });
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export function ModuleManagerPage() {
  const { locale, t } = useI18n();
  useSyncExternalStore(featureRegistry.subscribe, featureRegistry.getSnapshot, featureRegistry.getSnapshot);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [moduleData, setModuleData] = useState<ModuleDataInventoryItem[]>([]);
  const [grantsByModule, setGrantsByModule] = useState<Record<string, RuntimeFileGrant[]>>({});
  const [shortcutsByModule, setShortcutsByModule] = useState<Record<string, RuntimeShortcutStatus[]>>({});
  const [shortcutToRebind, setShortcutToRebind] = useState<{
    moduleId: string;
    shortcut: RuntimeShortcutStatus;
  } | null>(null);
  const features = featureRegistry.getManageable();
  const runtimeFeatureIds = new Set(features.filter((feature) => feature.runtime).map((feature) => feature.id));
  const dataByModule = new Map(moduleData.map((item) => [item.moduleId, item]));
  const orphanedData = orphanedModuleData(moduleData, runtimeFeatureIds);

  useEffect(() => {
    void runtimeModuleApi.listData()
      .then(setModuleData)
      .catch((error) => setFeedback(messageOf(error, locale)));
  }, [locale]);

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
      setFeedback(t(result.packageInstalled ? "modules.installedNoPlanChange" : "modules.noPlanChange"));
      setBusyAction(null);
    } catch (error) {
      setFeedback(messageOf(error, locale));
      setBusyAction(null);
    }
  };

  const installPackage = async () => {
    if (!isTauri()) {
      setFeedback(t("modules.desktopOnlyInstall"));
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
      setFeedback(messageOf(error, locale));
      setBusyAction(null);
    }
  };

  const clearModuleData = async (moduleId: string) => {
    if (!confirm(t("modules.confirmClear", { module: moduleId }))) return;
    setBusyAction(`clear-data:${moduleId}`);
    setFeedback(null);
    try {
      setModuleData(await runtimeModuleApi.clearData(moduleId));
      setFeedback(t("modules.cleared", { module: moduleId }));
    } catch (error) {
      setFeedback(messageOf(error, locale));
    } finally {
      setBusyAction(null);
    }
  };

  const createFileGrant = async (moduleId: string, kind: RuntimeFileGrant["kind"]) => {
    if (!isTauri()) return setFeedback(t("modules.desktopOnlyGrant"));
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
      setFeedback(t("modules.grantSaved"));
    } catch (error) {
      setFeedback(messageOf(error, locale));
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
      setFeedback(messageOf(error, locale));
    } finally {
      setBusyAction(null);
    }
  };

  const rebindShortcut = async (moduleId: string, shortcut: RuntimeShortcutStatus, accelerator: string) => {
    setFeedback(null);
    try {
      const shortcuts = await runtimeModuleApi.rebindShortcut(moduleId, shortcut.shortcutId, accelerator);
      setShortcutsByModule((current) => ({ ...current, [moduleId]: shortcuts }));
      setFeedback(t("modules.shortcutRebound"));
      return true;
    } catch (error) {
      setFeedback(messageOf(error, locale));
      return false;
    }
  };

  const disableShortcut = async (moduleId: string, shortcutId: string) => {
    try {
      const shortcuts = await runtimeModuleApi.disableShortcut(moduleId, shortcutId);
      setShortcutsByModule((current) => ({ ...current, [moduleId]: shortcuts }));
      setFeedback(t("modules.shortcutDisabled"));
    } catch (error) {
      setFeedback(messageOf(error, locale));
    }
  };

  return (
    <section className="space-y-5">
      {shortcutToRebind && (
        <ShortcutRecorderDialog
          open
          shortcutId={shortcutToRebind.shortcut.shortcutId}
          currentAccelerator={shortcutToRebind.shortcut.accelerator}
          onOpenChange={(open) => {
            if (!open) setShortcutToRebind(null);
          }}
          onConfirm={(accelerator) => rebindShortcut(
            shortcutToRebind.moduleId,
            shortcutToRebind.shortcut,
            accelerator,
          )}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="font-semibold">{t("modules.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("modules.description")}</p>
        </div>
        <Button onClick={() => void installPackage()} disabled={busyAction !== null}>
          <PackagePlus className="size-4" />{t(busyAction === "install" ? "modules.installing" : "modules.install")}
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
          const state = getModuleManagementState(feature, enabled, locale);
          const runtime = feature.runtime;
          const data = dataByModule.get(feature.id);
          const isBusy = busyAction?.endsWith(`:${feature.id}`) ?? false;
          const moduleName = resolveLocalizedText(feature.name, locale);
          const moduleDescription = resolveLocalizedText(feature.description, locale);
          const listSeparator = locale === "zh-CN" ? "、" : ", ";

          return (
            <Card key={feature.id}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Boxes className="size-4 text-primary" />
                    <CardTitle>{moduleName}</CardTitle>
                    <Badge variant="outline">v{state.version}</Badge>
                    <Badge variant="secondary">{state.sourceLabel}</Badge>
                  </div>
                  <CardDescription>{moduleDescription}</CardDescription>
                  <p className="text-xs text-muted-foreground">
                    {t("modules.pagesAndSettings", { pages: feature.navigation?.length ?? 0, settings: feature.settings?.length ?? 0, id: feature.id })}
                  </p>
                  {runtime && (
                    <p className="text-xs text-muted-foreground">
                      {t("modules.selectedInstalled", {
                        selected: runtime.selectedVersion ? `v${runtime.selectedVersion}` : t("common.none"),
                        installed: state.availableVersions.map((version) => `v${version}`).join(listSeparator),
                      })}
                    </p>
                  )}
                  {runtime && data && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Database className="size-3.5" />{t("modules.databaseUsage", { size: formatModuleDataSize(data.sizeBytes) })}
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
                      void featureRegistry.setEnabled(feature, checked).catch((error) => setFeedback(messageOf(error, locale)));
                    }
                  }}
                  aria-label={t(state.toggleChecked ? "modules.disable" : "modules.enable", { module: moduleName })}
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
                  <div><span className="text-muted-foreground">{t("modules.requiredDependencies")}</span><p className="mt-1 break-words">{state.requiredDependencies.join(listSeparator) || t("common.none")}</p></div>
                  <div><span className="text-muted-foreground">{t("modules.optionalDependencies")}</span><p className="mt-1 break-words">{state.optionalDependencies.join(listSeparator) || t("common.none")}</p></div>
                  <div><span className="text-muted-foreground">{t("modules.dependents")}</span><p className="mt-1 break-words">{state.dependents.join(listSeparator) || t("common.none")}</p></div>
                </div>
              )}

              {runtime && (runtime.manifest.sdkVersion >= 3 || runtime.permissionStatus !== "not_required") && (
                <div className="mx-5 mb-4 space-y-3 rounded-lg border border-border p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 font-medium"><ShieldCheck className="size-4 text-primary" />{t("modules.nativeCapabilities")}</p>
                    <div className="flex gap-2">
                      {state.canApprovePermissions && state.permissionVersion && (
                        <Button
                          size="sm"
                          disabled={busyAction !== null}
                          onClick={() => {
                            if (!confirm(t("modules.confirmApprove", { module: moduleName, version: state.permissionVersion ?? "" }))) return;
                            void runReloadingAction(`approve:${feature.id}`, () => runtimeModuleApi.approveNativePermissions(feature.id, state.permissionVersion as string));
                          }}
                        >{t("modules.approveEnable")}</Button>
                      )}
                      {state.canRevokePermissions && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyAction !== null}
                          onClick={() => {
                            if (!confirm(t("modules.confirmRevoke", { module: moduleName }))) return;
                            void runReloadingAction(`revoke:${feature.id}`, () => runtimeModuleApi.revokeNativePermissions(feature.id));
                          }}
                        >{t("modules.revokePermission")}</Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1 text-muted-foreground">
                    {state.permissionSummary.length > 0
                      ? state.permissionSummary.map((item, index) => <p key={`${item.kind}:${index}`}>· {formatPermissionSummary(item, locale)}</p>)
                      : <p>{t("modules.noNativeCapabilities")}</p>}
                  </div>

                  {state.canRevokePermissions && (
                    <div className="space-y-2 border-t border-border pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <FolderKey className="size-4 text-primary" />
                        {runtime.manifest.nativeCapabilities?.filesystem?.external.some((access) => access === "read" || access === "write") && (
                          <Button variant="outline" size="sm" onClick={() => void createFileGrant(feature.id, "file")}>{t("modules.grantFile")}</Button>
                        )}
                        {runtime.manifest.nativeCapabilities?.filesystem?.external.includes("list") && (
                          <Button variant="outline" size="sm" onClick={() => void createFileGrant(feature.id, "directory")}>{t("modules.grantDirectory")}</Button>
                        )}
                        {runtime.manifest.nativeCapabilities?.process?.executableGrants && (
                          <Button variant="outline" size="sm" onClick={() => void createFileGrant(feature.id, "executable")}>{t("modules.grantExecutable")}</Button>
                        )}
                      </div>
                      {(grantsByModule[feature.id] ?? []).map((grant) => (
                        <div key={grant.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                          <span>{grant.displayName} · {t(`modules.grantKind.${grant.kind}`)}</span>
                          <Button variant="ghost" size="sm" onClick={() => void revokeFileGrant(feature.id, grant.id)}>{t("modules.revoke")}</Button>
                        </div>
                      ))}
                      {(shortcutsByModule[feature.id] ?? []).length > 0 && (
                        <div className="space-y-1 border-t border-border pt-2">
                          <p className="flex items-center gap-1.5 font-medium"><Keyboard className="size-4 text-primary" />{t("modules.globalShortcuts")}</p>
                          {(shortcutsByModule[feature.id] ?? []).map((shortcut) => (
                            <div key={shortcut.shortcutId} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                              <span>{shortcut.shortcutId} · {shortcut.accelerator ?? t("modules.shortcut.disabled")} · {t(shortcut.state === "conflict" ? "modules.shortcut.conflict" : shortcut.state === "registered" ? "modules.shortcut.registered" : "modules.shortcut.disabled")}</span>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => setShortcutToRebind({ moduleId: feature.id, shortcut })}>{t("modules.rebind")}</Button>
                                {shortcut.state !== "disabled" && (
                                  <Button variant="ghost" size="sm" onClick={() => void disableShortcut(feature.id, shortcut.shortcutId)}>{t("modules.disableShortcut")}</Button>
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
                  <Power className="size-4" />{t("modules.runtimeStatus")}
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
                        title={state.status === "active" ? t("modules.stopBeforeClear") : undefined}
                        onClick={() => void clearModuleData(feature.id)}
                      >
                        <Database className="size-3.5" />{t(isBusy && busyAction?.startsWith("clear-data") ? "modules.clearing" : "modules.clearData")}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!state.canRollback || busyAction !== null}
                      onClick={() => {
                        if (!confirm(t("modules.confirmRollback", { module: moduleName, version: runtime.previousSelectedVersion ?? "" }))) return;
                        void runReloadingAction(`rollback:${feature.id}`, () => runtimeModuleApi.rollback(feature.id));
                      }}
                    >
                      <RotateCcw className="size-3.5" />{t(isBusy && busyAction?.startsWith("rollback") ? "modules.rollingBack" : "modules.rollback")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!state.canUninstall || busyAction !== null}
                      onClick={() => {
                        if (!confirm(t("modules.confirmUninstall", { module: moduleName }))) return;
                        void runReloadingAction(`uninstall:${feature.id}`, () => runtimeModuleApi.uninstall(feature.id));
                      }}
                    >
                      <Trash2 className="size-3.5" />{t(isBusy && busyAction?.startsWith("uninstall") ? "modules.uninstalling" : "modules.uninstall")}
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
            <h3 className="font-semibold">{t("modules.retainedData")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("modules.retainedDataDescription")}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {orphanedData.map((data) => (
              <Card key={data.moduleId}>
                <CardContent className="flex items-center justify-between gap-3 pt-5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium"><Database className="size-4 text-primary" />{data.moduleId}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t("modules.databaseUsage", { size: formatModuleDataSize(data.sizeBytes) })}</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busyAction !== null}
                    onClick={() => void clearModuleData(data.moduleId)}
                  >
                    <Trash2 className="size-3.5" />{t(busyAction === `clear-data:${data.moduleId}` ? "modules.clearing" : "modules.clearData")}
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
