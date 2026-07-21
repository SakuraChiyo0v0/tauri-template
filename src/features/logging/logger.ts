import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { debug, error, info, trace, warn } from "@tauri-apps/plugin-log";
import { isFeatureEnabled } from "@/core/features/feature-state";
import { getSetting } from "@/core/settings/setting-store";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const featureId = "logging";
const ranks: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
const pluginLoggers = { trace, debug, info, warn, error };
const consoleLoggers = {
  trace: console.debug,
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

async function write(level: LogLevel, message: string) {
  if (!isFeatureEnabled(featureId, true)) return;
  const threshold = getSetting<LogLevel>(featureId, "level", "info");
  if (ranks[level] < ranks[threshold]) return;

  if (getSetting(featureId, "mirrorToConsole", true)) consoleLoggers[level](message);
  if (isTauri()) await pluginLoggers[level](message);
}

export const logger = {
  trace: (message: string) => write("trace", message),
  debug: (message: string) => write("debug", message),
  info: (message: string) => write("info", message),
  warn: (message: string) => write("warn", message),
  error: (message: string) => write("error", message),
};

export async function applyNativeLogLevel(value: unknown) {
  if (isTauri() && typeof value === "string") await invoke("set_log_level", { level: value });
}
