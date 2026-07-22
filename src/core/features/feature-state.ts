import { useSyncExternalStore } from "react";

type FeatureState = Record<string, boolean>;

const STORAGE_KEY = "modular-tauri.features.v1";
const listeners = new Set<() => void>();

function readState(): FeatureState {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as FeatureState;
  } catch {
    return {};
  }
}

let state = readState();

export function isFeatureEnabled(id: string, defaultEnabled: boolean) {
  return state[id] ?? defaultEnabled;
}

export function setFeatureEnabled(id: string, enabled: boolean) {
  state = { ...state, [id]: enabled };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  listeners.forEach((listener) => listener());
}

export function getFeatureStateSnapshot() {
  return state;
}

export function subscribeFeatureState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFeatureStateSnapshot() {
  return useSyncExternalStore(subscribeFeatureState, getFeatureStateSnapshot, getFeatureStateSnapshot);
}
