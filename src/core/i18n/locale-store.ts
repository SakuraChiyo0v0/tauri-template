import { useSyncExternalStore } from "react";

export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const STORAGE_KEY = "modular-tauri.locale.v1";
export const DEFAULT_LOCALE: SupportedLocale = "zh-CN";

function normalizeLocale(value: unknown): SupportedLocale {
  return value === "en" || value === "zh-CN" ? value : DEFAULT_LOCALE;
}

function applyDocumentLocale(locale: SupportedLocale) {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export function createLocaleStore(storage?: Pick<Storage, "getItem" | "setItem">) {
  let locale = normalizeLocale(storage?.getItem(STORAGE_KEY));
  const listeners = new Set<() => void>();
  applyDocumentLocale(locale);

  return {
    getSnapshot: () => locale,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLocale(nextLocale: SupportedLocale) {
      const normalized = normalizeLocale(nextLocale);
      if (normalized === locale) return;
      locale = normalized;
      storage?.setItem(STORAGE_KEY, locale);
      applyDocumentLocale(locale);
      listeners.forEach((listener) => listener());
    },
  };
}

const browserStorage = typeof localStorage === "undefined" ? undefined : localStorage;
const localeStore = createLocaleStore(browserStorage);

export const getLocaleSnapshot = localeStore.getSnapshot;
export const subscribeLocale = localeStore.subscribe;
export const setLocale = localeStore.setLocale;

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocaleSnapshot, getLocaleSnapshot);
}
