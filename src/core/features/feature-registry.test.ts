import { describe, expect, it } from "vitest";
import { FeatureRegistry } from "./feature-registry";
import { defineFeature } from "./feature-types";

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
});
