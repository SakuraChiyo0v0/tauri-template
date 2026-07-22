import { describe, expect, it } from "vitest";
import { canClearModuleData, formatModuleDataSize, orphanedModuleData } from "./runtime-module-data";
import type { ModuleDataInventoryItem } from "./runtime-module-types";

const inventory: ModuleDataInventoryItem[] = [
  { moduleId: "active-module", sizeBytes: 1536, installed: true },
  { moduleId: "orphan-module", sizeBytes: 0, installed: false },
];

describe("runtime module data management", () => {
  it("formats database usage without hiding small files", () => {
    expect(formatModuleDataSize(0)).toBe("0 B");
    expect(formatModuleDataSize(1536)).toBe("1.5 KB");
  });

  it("keeps uninstalled database entries visible as orphaned data", () => {
    expect(orphanedModuleData(inventory, new Set(["active-module"]))).toEqual([
      { moduleId: "orphan-module", sizeBytes: 0, installed: false },
    ]);
  });

  it("allows clearing only disabled or uninstalled module data", () => {
    expect(canClearModuleData("active", true)).toBe(false);
    expect(canClearModuleData("disabled", true)).toBe(true);
    expect(canClearModuleData(undefined, false)).toBe(true);
  });
});
