import { useMemo, useState, useSyncExternalStore } from "react";
import { Download, Inbox, Search, SquareTerminal, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const levelLabels: Record<LogFilter, string> = {
  all: "全部",
  trace: "跟踪",
  debug: "调试",
  info: "信息",
  warn: "警告",
  error: "错误",
};

const levelStyles: Record<LogEntry["level"], string> = {
  trace: "border-border bg-muted text-muted-foreground",
  debug: "border-border bg-secondary text-secondary-foreground",
  info: "border-primary/20 bg-primary/10 text-primary",
  warn: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-destructive/25 bg-destructive/10 text-destructive",
};

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat("zh-CN", {
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
              <h2 className="text-lg font-semibold">日志控制台</h2>
              <p className="text-sm text-muted-foreground">查看当前运行会话中的前端、模块和 Rust 日志。</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={visibleEntries.length === 0} onClick={() => downloadEntries(visibleEntries, "json")}>
              <Download className="size-4" />导出 JSON
            </Button>
            <Button variant="outline" disabled={visibleEntries.length === 0} onClick={() => downloadEntries(visibleEntries, "text")}>
              <Download className="size-4" />导出文本
            </Button>
            <Button variant="destructive" disabled={entries.length === 0} onClick={clearLogEntries}>
              <Trash2 className="size-4" />清空
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-border bg-muted/20 p-4 md:flex-row md:items-center">
          <Tabs value={level} onValueChange={(value) => setLevel(value as LogFilter)}>
            <TabsList className="h-auto flex-wrap justify-start">
              {(Object.keys(levelLabels) as LogFilter[]).map((item) => (
                <TabsTrigger key={item} value={item}>{levelLabels[item]}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索日志内容或来源"
              aria-label="搜索日志"
              className="pl-9"
            />
          </div>
          <div className="shrink-0 text-sm text-muted-foreground">{visibleEntries.length} 条</div>
        </div>

        <div className="min-h-72 max-h-[calc(100vh-22rem)] overflow-auto">
          {visibleEntries.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
              <Inbox className="size-8" />
              <div>
                <p className="text-sm font-medium text-foreground">没有匹配的日志</p>
                <p className="mt-1 text-xs">等待新日志，或调整当前的筛选条件。</p>
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
                    {formatTimestamp(entry.timestamp)}
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
        控制台最多保留当前会话最近 1000 条日志；清空不会删除磁盘中的历史日志文件。
      </p>
    </section>
  );
}
