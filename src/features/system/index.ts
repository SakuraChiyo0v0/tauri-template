import { Boxes, Settings2 } from "lucide-react";
import { defineFeature } from "@/core/features/feature-types";
import { ModuleManagerPage } from "@/pages/module-manager-page";
import { SettingsPage } from "@/pages/settings-page";

export const systemFeature = defineFeature({
  id: "system",
  name: { "zh-CN": "系统", en: "System" },
  description: {
    "zh-CN": "提供模块管理和应用设置等基础页面。",
    en: "Provides module management and application settings.",
  },
  version: "0.1.0",
  defaultEnabled: true,
  canDisable: false,
  hiddenFromManager: true,
  navigation: [
    {
      id: "modules",
      title: { "zh-CN": "模块管理", en: "Modules" },
      description: {
        "zh-CN": "查看和控制内置模块与本地运行时模块",
        en: "Inspect and manage built-in and local runtime modules",
      },
      icon: Boxes,
      component: ModuleManagerPage,
      group: "main",
      order: 900,
    },
    {
      id: "settings",
      title: { "zh-CN": "设置", en: "Settings" },
      description: {
        "zh-CN": "管理外观和模块贡献的设置项",
        en: "Manage appearance and settings contributed by modules",
      },
      icon: Settings2,
      component: SettingsPage,
      group: "system",
      order: 1000,
    },
  ],
});
