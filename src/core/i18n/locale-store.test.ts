import { describe, expect, it, vi } from "vitest";
import { createLocaleStore } from "./locale-store";

describe("locale store", () => {
  it("defaults to Simplified Chinese and updates the document language", () => {
    const store = createLocaleStore(localStorage);

    expect(store.getSnapshot()).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("persists English and notifies subscribers", () => {
    const store = createLocaleStore(localStorage);
    const listener = vi.fn();
    store.subscribe(listener);

    store.setLocale("en");

    expect(store.getSnapshot()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("modular-tauri.locale.v1")).toBe("en");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(createLocaleStore(localStorage).getSnapshot()).toBe("en");
  });

  it("falls back to Chinese for unsupported stored values", () => {
    localStorage.setItem("modular-tauri.locale.v1", "ja");

    expect(createLocaleStore(localStorage).getSnapshot()).toBe("zh-CN");
  });

  it("changes only locale persistence and leaves module state and settings untouched", () => {
    const featureState = JSON.stringify({ logging: false });
    const settings = JSON.stringify({ logging: { level: "warn" } });
    localStorage.setItem("modular-tauri.features.v1", featureState);
    localStorage.setItem("modular-tauri.settings.v1", settings);
    const store = createLocaleStore(localStorage);

    store.setLocale("en");

    expect(localStorage.getItem("modular-tauri.features.v1")).toBe(featureState);
    expect(localStorage.getItem("modular-tauri.settings.v1")).toBe(settings);
  });
});
