import { useSyncExternalStore } from "react";
import type { ColorMode, ThemePresetId, ThemeState } from "./theme-types";

const STORAGE_KEY = "modular-tauri.theme.v1";
const DEFAULT_THEME: ThemeState = { mode: "system", preset: "neutral" };
const listeners = new Set<() => void>();

function readStoredTheme(): ThemeState {
  if (typeof localStorage === "undefined") return DEFAULT_THEME;

  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ThemeState> | null;
    return {
      mode: value?.mode === "light" || value?.mode === "dark" || value?.mode === "system" ? value.mode : DEFAULT_THEME.mode,
      preset: value?.preset === "ocean" || value?.preset === "neutral" ? value.preset : DEFAULT_THEME.preset,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

let state = readStoredTheme();

export function resolveColorMode(mode: ColorMode, systemPrefersDark: boolean): "light" | "dark" {
  return mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;
}

export function applyTheme(nextState = state) {
  if (typeof document === "undefined") return;
  const prefersDark = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  const resolvedMode = resolveColorMode(nextState.mode, prefersDark);
  document.documentElement.dataset.theme = nextState.preset;
  document.documentElement.classList.toggle("dark", resolvedMode === "dark");
  document.documentElement.style.colorScheme = resolvedMode;
}

function updateState(nextState: ThemeState) {
  state = nextState;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  applyTheme(state);
  listeners.forEach((listener) => listener());
}

export function setColorMode(mode: ColorMode) {
  updateState({ ...state, mode });
}

export function setThemePreset(preset: ThemePresetId) {
  updateState({ ...state, preset });
}

export function getThemeSnapshot() {
  return state;
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeSnapshot);
  return { ...snapshot, setColorMode, setThemePreset };
}

applyTheme();
