import { Boxes, Settings2 } from "lucide-react";
import { defineFeature } from "@/core/features/feature-types";
import { ModuleManagerPage } from "@/pages/module-manager-page";
import { SettingsPage } from "@/pages/settings-page";

export const systemFeature = defineFeature({
  id: "system",
  name: "系统",
  description: "提供模块管理和应用设置等基础页面。",
  version: "0.1.0",
  defaultEnabled: true,
  canDisable: false,
  hiddenFromManager: true,
  navigation: [
    {
      id: "modules",
      title: "模块管理",
      description: "查看和控制已安装的源码模块",
      icon: Boxes,
      component: ModuleManagerPage,
      group: "main",
      order: 900,
    },
    {
      id: "settings",
      title: "设置",
      description: "管理外观和模块贡献的设置项",
      icon: Settings2,
      component: SettingsPage,
      group: "system",
      order: 1000,
    },
  ],
});
