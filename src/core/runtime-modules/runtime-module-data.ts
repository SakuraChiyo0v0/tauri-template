import type { ModuleDataInventoryItem, RuntimeModuleStatus } from "./runtime-module-types";

export function formatModuleDataSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = sizeBytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${Number(value.toFixed(value < 10 ? 1 : 0))} ${unit}`;
}

export function orphanedModuleData(
  inventory: readonly ModuleDataInventoryItem[],
  installedRuntimeModuleIds: ReadonlySet<string>,
) {
  return inventory.filter((item) => !item.installed || !installedRuntimeModuleIds.has(item.moduleId));
}

export function canClearModuleData(status: RuntimeModuleStatus | undefined, installed: boolean) {
  return !installed || status !== "active";
}
