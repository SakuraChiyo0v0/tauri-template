import React from "react";
import ReactDOM from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "./App";
import { featureRegistry } from "@/app/module-registry";
import { discoverRuntimeModules } from "@/core/runtime-modules/runtime-module-loader";
import { getLocaleSnapshot, subscribeLocale } from "@/core/i18n/locale-store";
import { ThemeProvider } from "@/themes/theme-provider";
import "@/styles/globals.css";

function initializeNativeLocaleSync() {
  if (!isTauri()) return;
  const sync = () => {
    void invoke("set_application_locale", { locale: getLocaleSnapshot() })
      .catch((error) => console.error("Failed to synchronize the native application locale.", error));
  };
  sync();
  subscribeLocale(sync);
}

async function bootstrap() {
  initializeNativeLocaleSync();
  try {
    await discoverRuntimeModules(featureRegistry);
  } catch (error) {
    console.error("运行时模块发现失败，底座将仅使用内置模块启动。", error);
  }

  try {
    await featureRegistry.initialize();
  } catch (error) {
    console.error("一个或多个模块初始化失败，底座将继续启动。", error);
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
