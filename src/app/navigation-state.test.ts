import { describe, expect, it } from "vitest";
import { resolveActiveNavigation } from "./navigation-state";
import type { ResolvedNavigation } from "@/core/features/feature-types";

function EmptyPage() {
  return null;
}

const navigation: ResolvedNavigation[] = [
  {
    id: "modules",
    title: "模块管理",
    icon: () => null,
    component: EmptyPage,
    group: "main",
    moduleId: "system",
    moduleName: "系统",
  },
  {
    id: "settings",
    title: "设置",
    icon: () => null,
    component: EmptyPage,
    group: "system",
    moduleId: "system",
    moduleName: "系统",
  },
];

describe("resolveActiveNavigation", () => {
  it("keeps a requested route while it remains registered", () => {
    expect(resolveActiveNavigation(navigation, "settings")?.id).toBe("settings");
  });

  it("falls back to the first registered route when the active module disappears", () => {
    expect(resolveActiveNavigation(navigation, "removed-feature")?.id).toBe("modules");
  });

  it("returns null when no module contributes a route", () => {
    expect(resolveActiveNavigation([], "removed-feature")).toBeNull();
  });
});
