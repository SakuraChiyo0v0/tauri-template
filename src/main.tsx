import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { featureRegistry } from "@/app/module-registry";
import { ThemeProvider } from "@/themes/theme-provider";
import "@/styles/globals.css";

void featureRegistry.initialize();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
