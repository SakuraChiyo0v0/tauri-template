import { describe, expect, it } from "vitest";
import { translate } from "./messages";

describe("application messages", () => {
  it("translates fixed and parameterized messages", () => {
    expect(translate("zh-CN", "app.tagline")).toBe("可扩展桌面底座");
    expect(translate("en", "app.tagline")).toBe("Extensible desktop foundation");
    expect(translate("zh-CN", "settings.providerCount", { count: 2 })).toBe("由 2 个已启用模块提供");
    expect(translate("en", "settings.providerCount", { count: 2 })).toBe("Provided by 2 enabled modules");
  });
});
