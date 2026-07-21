import { describe, expect, it } from "vitest";
import { resolveColorMode } from "./theme-store";

describe("resolveColorMode", () => {
  it("follows the operating system only in system mode", () => {
    expect(resolveColorMode("system", true)).toBe("dark");
    expect(resolveColorMode("system", false)).toBe("light");
    expect(resolveColorMode("light", true)).toBe("light");
    expect(resolveColorMode("dark", false)).toBe("dark");
  });
});
