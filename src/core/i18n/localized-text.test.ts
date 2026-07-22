import { describe, expect, expectTypeOf, it } from "vitest";
import { isLocalizedText, resolveLocalizedText, type LocalizedText } from "./localized-text";

const greeting: LocalizedText = { "zh-CN": "你好", en: "Hello" };

describe("localized text", () => {
  it("resolves the exact supported language", () => {
    expect(resolveLocalizedText(greeting, "zh-CN")).toBe("你好");
    expect(resolveLocalizedText(greeting, "en")).toBe("Hello");
  });

  it("requires both non-empty language values", () => {
    expect(isLocalizedText(greeting)).toBe(true);
    expect(isLocalizedText({ "zh-CN": "你好" })).toBe(false);
    expect(isLocalizedText({ "zh-CN": "你好", en: "  " })).toBe(false);
    expect(isLocalizedText({ "zh-CN": "你好", en: "Hello", ja: "こんにちは" })).toBe(false);
  });

  it("exposes a strict two-language TypeScript shape", () => {
    expectTypeOf<LocalizedText>().toEqualTypeOf<{ "zh-CN": string; en: string }>();
  });
});
