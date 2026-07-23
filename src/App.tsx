import { useEffect, useState, useSyncExternalStore } from "react";
import { Boxes, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { featureRegistry } from "@/app/feature-registry";
import { readStoredNavigationId, resolveActiveNavigation, storeNavigationId } from "@/app/navigation-state";
import { Badge } from "@/components/ui/badge";
import type { ResolvedNavigation } from "@/core/features/feature-types";
import { useI18n } from "@/core/i18n/use-i18n";
import { ModuleDialogContainer } from "@/core/runtime-modules/runtime-module-dialog-container";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "modular-tauri.sidebar-collapsed.v1";

function NavigationButton({ entry, active, collapsed, onSelect }: {
  entry: ResolvedNavigation;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
}) {
  const Icon = entry.icon;

  return (
    <button
      type="button"
      title={collapsed ? entry.title : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "group flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className={cn("size-5 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
      {!collapsed && <span className="truncate">{entry.title}</span>}
    </button>
  );
}

function App() {
  const { locale, t } = useI18n();
  useSyncExternalStore(featureRegistry.subscribe, featureRegistry.getSnapshot, featureRegistry.getSnapshot);
  const navigation = featureRegistry.getNavigation(locale);
  const [requestedNavigationId, setRequestedNavigationId] = useState(readStoredNavigationId);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true",
  );
  const activeNavigation = resolveActiveNavigation(navigation, requestedNavigationId);
  const mainNavigation = navigation.filter((entry) => (entry.group ?? "main") === "main");
  const systemNavigation = navigation.filter((entry) => entry.group === "system");

  useEffect(() => {
    if (activeNavigation && activeNavigation.id !== requestedNavigationId) {
      setRequestedNavigationId(activeNavigation.id);
      storeNavigationId(activeNavigation.id);
    }
  }, [activeNavigation, requestedNavigationId]);

  const selectNavigation = (id: string) => {
    setRequestedNavigationId(id);
    storeNavigationId(id);
  };

  const toggleSidebar = () => {
    const nextValue = !sidebarCollapsed;
    setSidebarCollapsed(nextValue);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextValue));
  };

  const ActivePage = activeNavigation?.component;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200",
          sidebarCollapsed ? "w-[72px]" : "w-56",
        )}
      >
        <div className={cn("flex h-16 items-center border-b border-border px-4", sidebarCollapsed ? "justify-center" : "gap-3")}>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background shadow-sm">
            <Boxes className="size-5 text-primary" />
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">Modular Tauri</div>
              <div className="truncate text-xs text-muted-foreground">{t("app.tagline")}</div>
            </div>
          )}
        </div>

        <nav className="flex min-h-0 flex-1 flex-col p-3" aria-label={t("app.navigation")}>
          <div className="space-y-1">
            {mainNavigation.map((entry) => (
              <NavigationButton
                key={entry.id}
                entry={entry}
                active={entry.id === activeNavigation?.id}
                collapsed={sidebarCollapsed}
                onSelect={() => selectNavigation(entry.id)}
              />
            ))}
          </div>

          <div className="mt-auto space-y-1 border-t border-border pt-3">
            {systemNavigation.map((entry) => (
              <NavigationButton
                key={entry.id}
                entry={entry}
                active={entry.id === activeNavigation?.id}
                collapsed={sidebarCollapsed}
                onSelect={() => selectNavigation(entry.id)}
              />
            ))}
          </div>
        </nav>

        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(
              "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              sidebarCollapsed && "justify-center px-0",
            )}
            aria-label={sidebarCollapsed ? t("app.expandSidebar") : t("app.collapseSidebar")}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
            {!sidebarCollapsed && <span>{t("app.collapseSidebar")}</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-7">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{activeNavigation?.title ?? t("app.noAvailablePage")}</h1>
            {activeNavigation?.description && <p className="mt-1 truncate text-sm text-muted-foreground">{activeNavigation.description}</p>}
          </div>
          {activeNavigation && <Badge variant="outline">{activeNavigation.moduleName}</Badge>}
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto bg-muted/25 p-7">
          <div className="mx-auto w-full max-w-6xl">
            {ActivePage ? (
              <ActivePage />
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
                {t("app.noRegisteredPage")}
              </div>
            )}
          </div>
        </main>
      </div>
      <ModuleDialogContainer />
    </div>
  );
}

export default App;
