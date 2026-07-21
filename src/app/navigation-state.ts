import type { ResolvedNavigation } from "@/core/features/feature-types";

const STORAGE_KEY = "modular-tauri.navigation.v1";

export function readStoredNavigationId() {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function storeNavigationId(id: string) {
  localStorage.setItem(STORAGE_KEY, id);
}

export function resolveActiveNavigation(navigation: readonly ResolvedNavigation[], requestedId: string | null) {
  return navigation.find((entry) => entry.id === requestedId) ?? navigation[0] ?? null;
}
