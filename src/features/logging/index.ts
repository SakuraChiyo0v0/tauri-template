import { SquareTerminal } from "lucide-react";
import { defineFeature } from "@/core/features/feature-types";
import { getSetting } from "@/core/settings/setting-store";
import { LogConsolePage } from "./log-console-page";
import { applyNativeLogLevel, attachNativeLogBridge, logger, type LogLevel } from "./logger";

export const loggingFeature = defineFeature({
  id: "logging",
  name: { "zh-CN": "日志", en: "Logs" },
  description: {
    "zh-CN": "为前端和 Rust 提供统一的分级日志，并写入应用日志目录。",
    en: "Provides unified leveled logs for the frontend and Rust runtime.",
  },
  version: "0.1.0",
  defaultEnabled: true,
  navigation: [
    {
      id: "logs",
      title: { "zh-CN": "日志", en: "Logs" },
      description: {
        "zh-CN": "查看和筛选当前运行会话的分级日志",
        en: "Inspect and filter leveled logs from the current session",
      },
      icon: SquareTerminal,
      group: "main",
      order: 100,
      component: LogConsolePage,
    },
  ],
  settings: [
    {
      id: "level",
      type: "select",
      group: "diagnostics",
      order: 10,
      label: { "zh-CN": "日志级别", en: "Log level" },
      description: {
        "zh-CN": "低于所选级别的日志不会被记录。",
        en: "Messages below the selected level are not recorded.",
      },
      defaultValue: "info",
      options: [
        { label: { "zh-CN": "跟踪", en: "Trace" }, value: "trace" },
        { label: { "zh-CN": "调试", en: "Debug" }, value: "debug" },
        { label: { "zh-CN": "信息", en: "Info" }, value: "info" },
        { label: { "zh-CN": "警告", en: "Warning" }, value: "warn" },
        { label: { "zh-CN": "错误", en: "Error" }, value: "error" },
      ],
      onChange: applyNativeLogLevel,
    },
    {
      id: "mirrorToConsole",
      type: "switch",
      group: "diagnostics",
      order: 20,
      label: { "zh-CN": "同步到开发者控制台", en: "Mirror to developer console" },
      description: {
        "zh-CN": "同时在 WebView 开发者控制台输出前端日志。",
        en: "Also write frontend logs to the WebView developer console.",
      },
      defaultValue: true,
    },
  ],
  setup: async () => {
    try {
      await attachNativeLogBridge();
    } catch (error) {
      console.error("Failed to attach native log bridge", error);
    }
    const level = getSetting<LogLevel>("logging", "level", "info");
    await applyNativeLogLevel(level);
    await logger.info("Logging feature initialized");
  },
});

export { logger } from "./logger";
