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

export function getLegacyDisabledFeatureIds() {
  return Object.entries(state)
    .filter(([, enabled]) => enabled === false)
    .map(([id]) => id)
    .sort();
}

export function clearLegacyFeatureState(featureIds: readonly string[]) {
  const ids = new Set(featureIds);
  const next = Object.fromEntries(Object.entries(state).filter(([id]) => !ids.has(id)));
  if (Object.keys(next).length === Object.keys(state).length) return;
  state = next;
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
