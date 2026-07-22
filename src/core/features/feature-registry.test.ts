import { describe, expect, it, vi } from "vitest";
import { FeatureRegistry } from "./feature-registry";
import { defineFeature } from "./feature-types";

function EmptyPage() {
  return null;
}

function createFeature(id: string) {
  return defineFeature({
    id,
    name: "测试模块",
    description: "用于验证注册表行为",
    version: "1.0.0",
    defaultEnabled: true,
    settings: [
      {
        id: "enabledOption",
        type: "switch",
        group: "features",
        label: "测试设置",
        defaultValue: true,
      },
    ],
  });
}

describe("FeatureRegistry", () => {
  it("collects settings from enabled modules without coupling to the settings page", () => {
    const registry = new FeatureRegistry().register(createFeature("registry-collect-test"));

    expect(registry.getSettings()).toMatchObject([
      { moduleId: "registry-collect-test", id: "enabledOption", group: "features" },
    ]);
  });

  it("removes a disabled module's setting contributions", async () => {
    const feature = createFeature("registry-disable-test");
    const registry = new FeatureRegistry().register(feature);

    await registry.setEnabled(feature, false);

    expect(registry.getSettings()).toEqual([]);
  });

  it("rejects duplicate module identifiers", () => {
    const registry = new FeatureRegistry().register(createFeature("duplicate-test"));

    expect(() => registry.register(createFeature("duplicate-test"))).toThrow(/already registered/);
  });

  it("collects and orders navigation contributed by enabled modules", () => {
    const registry = new FeatureRegistry()
      .register(defineFeature({
        id: "navigation-main-test",
        name: "主功能",
        description: "主导航测试",
        version: "1.0.0",
        defaultEnabled: true,
        navigation: [
          { id: "later", title: "稍后", icon: () => null, component: EmptyPage, order: 20 },
          { id: "earlier", title: "优先", icon: () => null, component: EmptyPage, order: 10 },
        ],
      }))
      .register(defineFeature({
        id: "navigation-system-test",
        name: "系统功能",
        description: "系统导航测试",
        version: "1.0.0",
        defaultEnabled: true,
        hiddenFromManager: true,
        navigation: [
          { id: "settings-test", title: "设置", icon: () => null, component: EmptyPage, group: "system" },
        ],
      }));

    expect(registry.getNavigation().map((entry) => entry.id)).toEqual(["earlier", "later", "settings-test"]);
    expect(registry.getManageable().map((feature) => feature.id)).toEqual(["navigation-main-test"]);
  });

  it("removes navigation when its module is disabled", async () => {
    const feature = defineFeature({
      id: "navigation-disable-test",
      name: "可停用页面",
      description: "导航停用测试",
      version: "1.0.0",
      defaultEnabled: true,
      navigation: [
        { id: "removable-page", title: "可移除页面", icon: () => null, component: EmptyPage },
      ],
    });
    const registry = new FeatureRegistry().register(feature);

    await registry.setEnabled(feature, false);

    expect(registry.getNavigation()).toEqual([]);
  });

  it("marks source modules as builtin and accepts runtime modules", () => {
    const registry = new FeatureRegistry()
      .register(createFeature("builtin-source-test"))
      .register({ ...createFeature("runtime-source-test"), source: "runtime" });

    expect(registry.getAll().map(({ id, source }) => ({ id, source }))).toEqual([
      { id: "builtin-source-test", source: "builtin" },
      { id: "runtime-source-test", source: "runtime" },
    ]);
  });

  it("unregisters a runtime module and notifies subscribers", () => {
    const registry = new FeatureRegistry().register({ ...createFeature("runtime-remove-test"), source: "runtime" });
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    expect(registry.unregister("runtime-remove-test")).toBe(true);
    expect(registry.getAll()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not allow runtime removal of a builtin module", () => {
    const registry = new FeatureRegistry().register(createFeature("builtin-remove-test"));

    expect(registry.unregister("builtin-remove-test")).toBe(false);
    expect(registry.getAll()).toHaveLength(1);
  });

  it("keeps existing registrations unchanged when a runtime contribution conflicts", () => {
    const registry = new FeatureRegistry().register(defineFeature({
      id: "existing-navigation-test",
      name: "Existing",
      description: "Existing navigation",
      version: "1.0.0",
      defaultEnabled: true,
      navigation: [{ id: "shared-navigation", title: "Existing", icon: () => null, component: EmptyPage }],
    }));
    const listener = vi.fn();
    registry.subscribe(listener);

    expect(() => registry.register(defineFeature({
      id: "conflicting-runtime-test",
      source: "runtime",
      name: "Conflict",
      description: "Conflicting navigation",
      version: "1.0.0",
      defaultEnabled: true,
      navigation: [{ id: "shared-navigation", title: "Conflict", icon: () => null, component: EmptyPage }],
    }))).toThrow(/already registered/);
    expect(registry.getAll().map((feature) => feature.id)).toEqual(["existing-navigation-test"]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects custom element conflicts between runtime modules", () => {
    const registry = new FeatureRegistry().register({
      ...createFeature("runtime-elements-one"),
      source: "runtime",
      elementNames: ["shared-runtime-page"],
    });

    expect(() => registry.register({
      ...createFeature("runtime-elements-two"),
      source: "runtime",
      elementNames: ["shared-runtime-page"],
    })).toThrow(/Custom element.*already registered/);
  });

  it("runs teardown when an enabled source module is disabled", async () => {
    const teardown = vi.fn();
    const feature = { ...createFeature("source-teardown-test"), teardown };
    const registry = new FeatureRegistry().register(feature);

    await registry.setEnabled(feature, false);

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(registry.getSettings()).toEqual([]);
  });

  it("routes runtime enable state through the Rust activation plan", async () => {
    const feature = { ...createFeature("runtime-toggle-test"), source: "runtime" as const };
    const registry = new FeatureRegistry().register(feature);

    await expect(registry.setEnabled(feature, false)).rejects.toThrow(/全局激活计划/);
  });
});
