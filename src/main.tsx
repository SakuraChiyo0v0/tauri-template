import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { featureRegistry } from "@/app/module-registry";
import { discoverRuntimeModules } from "@/core/runtime-modules/runtime-module-loader";
import { ThemeProvider } from "@/themes/theme-provider";
import "@/styles/globals.css";

async function bootstrap() {
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
