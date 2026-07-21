import { useSyncExternalStore } from "react";

type SettingsRecord = Record<string, Record<string, unknown>>;

const STORAGE_KEY = "modular-tauri.settings.v1";
const listeners = new Set<() => void>();

function readSettings(): SettingsRecord {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as SettingsRecord;
  } catch {
    return {};
  }
}

let settings = readSettings();

export function getSetting<T>(moduleId: string, settingId: string, defaultValue: T): T {
  return (settings[moduleId]?.[settingId] as T | undefined) ?? defaultValue;
}

export function setSetting(moduleId: string, settingId: string, value: unknown) {
  settings = {
    ...settings,
    [moduleId]: { ...settings[moduleId], [settingId]: value },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  listeners.forEach((listener) => listener());
}

export function getSettingsSnapshot() {
  return settings;
}

export function subscribeSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSetting<T>(moduleId: string, settingId: string, defaultValue: T) {
  useSyncExternalStore(subscribeSettings, getSettingsSnapshot, getSettingsSnapshot);
  const value = getSetting(moduleId, settingId, defaultValue);
  return [value, (nextValue: T) => setSetting(moduleId, settingId, nextValue)] as const;
}
