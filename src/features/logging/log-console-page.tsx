import { useMemo, useState, useSyncExternalStore } from "react";
import { Download, Inbox, Search, SquareTerminal, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SupportedLocale } from "@/core/i18n/locale-store";
import type { MessageKey } from "@/core/i18n/messages";
import { useI18n } from "@/core/i18n/use-i18n";
import { cn } from "@/lib/utils";
import {
  clearLogEntries,
  filterLogEntries,
  getLogSnapshot,
  serializeLogEntries,
  subscribeLogStore,
  type LogEntry,
  type LogExportFormat,
  type LogFilter,
} from "./log-store";

const levelLabels: Record<LogFilter, MessageKey> = {
  all: "logs.level.all",
  trace: "logs.level.trace",
  debug: "logs.level.debug",
  info: "logs.level.info",
  warn: "logs.level.warn",
  error: "logs.level.error",
};

const levelStyles: Record<LogEntry["level"], string> = {
  trace: "border-border bg-muted text-muted-foreground",
  debug: "border-border bg-secondary text-secondary-foreground",
  info: "border-primary/20 bg-primary/10 text-primary",
  warn: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-destructive/25 bg-destructive/10 text-destructive",
};

function formatTimestamp(timestamp: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function downloadEntries(entries: readonly LogEntry[], format: LogExportFormat) {
  const content = serializeLogEntries(entries, format);
  const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `logs-${date}.${format === "json" ? "json" : "txt"}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function LogConsolePage() {
  const { locale, t } = useI18n();
  const entries = useSyncExternalStore(subscribeLogStore, getLogSnapshot, getLogSnapshot);
  const [level, setLevel] = useState<LogFilter>("all");
  const [query, setQuery] = useState("");
  const visibleEntries = useMemo(() => filterLogEntries(entries, level, query), [entries, level, query]);

  return (
    <section className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
              <SquareTerminal className="size-5 text-primary" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{t("logs.console")}</h2>
              <p className="text-sm text-muted-foreground">{t("logs.description")}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={visibleEntries.length === 0} onClick={() => downloadEntries(visibleEntries, "json")}>
              <Download className="size-4" />{t("logs.exportJson")}
            </Button>
            <Button variant="outline" disabled={visibleEntries.length === 0} onClick={() => downloadEntries(visibleEntries, "text")}>
              <Download className="size-4" />{t("logs.exportText")}
            </Button>
            <Button variant="destructive" disabled={entries.length === 0} onClick={clearLogEntries}>
              <Trash2 className="size-4" />{t("logs.clear")}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-border bg-muted/20 p-4 md:flex-row md:items-center">
          <Tabs value={level} onValueChange={(value) => setLevel(value as LogFilter)}>
            <TabsList className="h-auto flex-wrap justify-start">
              {(Object.keys(levelLabels) as LogFilter[]).map((item) => (
                <TabsTrigger key={item} value={item}>{t(levelLabels[item])}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("logs.search")}
              aria-label={t("logs.search")}
              className="pl-9"
            />
          </div>
          <div className="shrink-0 text-sm text-muted-foreground">{t("logs.count", { count: visibleEntries.length })}</div>
        </div>

        <div className="min-h-72 max-h-[calc(100vh-22rem)] overflow-auto">
          {visibleEntries.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
              <Inbox className="size-8" />
              <div>
                <p className="text-sm font-medium text-foreground">{t("logs.emptyTitle")}</p>
                <p className="mt-1 text-xs">{t("logs.emptyDescription")}</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="grid gap-2 px-4 py-3 text-sm hover:bg-muted/30 md:grid-cols-[11rem_5.5rem_8rem_minmax(0,1fr)] md:items-center md:px-5"
                >
                  <time className="font-mono text-xs text-muted-foreground" dateTime={entry.timestamp}>
                    {formatTimestamp(entry.timestamp, locale)}
                  </time>
                  <div>
                    <Badge className={cn("rounded-md font-mono font-medium", levelStyles[entry.level])} variant="outline">
                      {entry.level.toUpperCase()}
                    </Badge>
                  </div>
                  <span className="truncate font-mono text-xs text-muted-foreground" title={entry.source}>{entry.source}</span>
                  <span className="min-w-0 break-words font-mono text-xs leading-5 text-foreground">{entry.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        {t("logs.retention")}
      </p>
    </section>
  );
}
