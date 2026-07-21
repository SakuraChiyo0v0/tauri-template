import type { LogLevel } from "./logger";

export type LogFilter = LogLevel | "all";
export type LogExportFormat = "json" | "text";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

type NewLogEntry = Omit<LogEntry, "id" | "timestamp"> & { timestamp?: string };

const MAX_LOG_ENTRIES = 1_000;
const listeners = new Set<() => void>();
let sequence = 0;
let entries: LogEntry[] = [];

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function appendLogEntry(entry: NewLogEntry) {
  const timestamp = entry.timestamp ?? new Date().toISOString();
  const nextEntry: LogEntry = {
    ...entry,
    id: `${timestamp}-${sequence++}`,
    timestamp,
  };

  entries = [nextEntry, ...entries].slice(0, MAX_LOG_ENTRIES);
  emitChange();
  return nextEntry;
}

export function clearLogEntries() {
  if (entries.length === 0) return;
  entries = [];
  emitChange();
}

export function getLogSnapshot() {
  return entries;
}

export function subscribeLogStore(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function filterLogEntries(logEntries: readonly LogEntry[], level: LogFilter, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return logEntries.filter((entry) => {
    if (level !== "all" && entry.level !== level) return false;
    if (!normalizedQuery) return true;
    return `${entry.source} ${entry.message}`.toLocaleLowerCase().includes(normalizedQuery);
  });
}

export function serializeLogEntries(logEntries: readonly LogEntry[], format: LogExportFormat) {
  if (format === "json") return JSON.stringify(logEntries, null, 2);

  return logEntries
    .map((entry) => `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`)
    .join("\n");
}
