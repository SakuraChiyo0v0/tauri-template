import { defineFeature } from "@/core/features/feature-types";
import { getSetting } from "@/core/settings/setting-store";
import { applyNativeLogLevel, logger, type LogLevel } from "./logger";

export const loggingFeature = defineFeature({
  id: "logging",
  name: "日志",
  description: "为前端和 Rust 提供统一的分级日志，并写入应用日志目录。",
  version: "0.1.0",
  defaultEnabled: true,
  settings: [
    {
      id: "level",
      type: "select",
      group: "diagnostics",
      order: 10,
      label: "日志级别",
      description: "低于所选级别的日志不会被记录。",
      defaultValue: "info",
      options: [
        { label: "跟踪", value: "trace" },
        { label: "调试", value: "debug" },
        { label: "信息", value: "info" },
        { label: "警告", value: "warn" },
        { label: "错误", value: "error" },
      ],
      onChange: applyNativeLogLevel,
    },
    {
      id: "mirrorToConsole",
      type: "switch",
      group: "diagnostics",
      order: 20,
      label: "同步到开发者控制台",
      description: "同时在 WebView 开发者控制台输出前端日志。",
      defaultValue: true,
    },
  ],
  setup: async () => {
    const level = getSetting<LogLevel>("logging", "level", "info");
    await applyNativeLogLevel(level);
    await logger.info("Logging feature initialized");
  },
});

export { logger } from "./logger";
