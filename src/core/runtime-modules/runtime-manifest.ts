import type { SelectSetting, SwitchSetting } from "@/core/settings/setting-types";
import type { NavigationGroup } from "@/core/features/feature-types";

export const RUNTIME_MODULE_SCHEMA_VERSION = 1;
export const RUNTIME_MODULE_SDK_VERSION = 1;

export interface RuntimeNavigationManifest {
  id: string;
  title: string;
  description?: string;
  element: string;
  group?: NavigationGroup;
  order?: number;
}

export type RuntimeSettingManifest = SwitchSetting | SelectSetting;

export interface RuntimeModuleManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  hostVersion: string;
  sdkVersion: 1;
  entry: string;
  navigation: RuntimeNavigationManifest[];
  settings: RuntimeSettingManifest[];
}

const moduleIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const contributionIdPattern = /^[A-Za-z][A-Za-z0-9._-]{1,63}$/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const reservedModuleIds = new Set(["system", "logging"]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maxLength = 200) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, label: string) {
  return value === undefined ? undefined : string(value, label);
}

function parseNavigation(value: unknown, moduleId: string): RuntimeNavigationManifest[] {
  if (!Array.isArray(value)) throw new Error("navigation must be an array.");
  const ids = new Set<string>();
  const elements = new Set<string>();

  return value.map((item, index) => {
    const entry = object(item, `navigation[${index}]`);
    const id = string(entry.id, `navigation[${index}].id`, 64);
    if (!contributionIdPattern.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate navigation id: ${id}`);
    ids.add(id);

    const element = string(entry.element, `navigation[${index}].element`, 100);
    if (!element.startsWith(`${moduleId}-`) || !moduleIdPattern.test(element) || elements.has(element)) {
      throw new Error(`Invalid or duplicate custom element: ${element}`);
    }
    elements.add(element);

    const group = entry.group === undefined ? "main" : entry.group;
    if (group !== "main" && group !== "system") throw new Error(`Invalid navigation group: ${String(group)}`);
    if (entry.order !== undefined && (typeof entry.order !== "number" || !Number.isFinite(entry.order))) {
      throw new Error(`Invalid navigation order for ${id}`);
    }

    return {
      id,
      title: string(entry.title, `navigation[${index}].title`),
      description: optionalString(entry.description, `navigation[${index}].description`),
      element,
      group,
      order: entry.order as number | undefined,
    };
  });
}

function parseSettings(value: unknown): RuntimeSettingManifest[] {
  if (!Array.isArray(value)) throw new Error("settings must be an array.");
  const ids = new Set<string>();

  return value.map((item, index) => {
    const setting = object(item, `setting[${index}]`);
    const id = string(setting.id, `setting[${index}].id`, 64);
    if (!contributionIdPattern.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate setting id: ${id}`);
    ids.add(id);
    const base = {
      id,
      label: string(setting.label, `setting[${index}].label`),
      description: optionalString(setting.description, `setting[${index}].description`),
      group: string(setting.group, `setting[${index}].group`, 64),
      order: setting.order as number | undefined,
    };
    if (setting.order !== undefined && (typeof setting.order !== "number" || !Number.isFinite(setting.order))) {
      throw new Error(`Invalid setting order for ${id}`);
    }

    if (setting.type === "switch" && typeof setting.defaultValue === "boolean") {
      return { ...base, type: "switch", defaultValue: setting.defaultValue };
    }

    if (setting.type === "select" && typeof setting.defaultValue === "string" && Array.isArray(setting.options)) {
      const options = setting.options.map((option, optionIndex) => {
        const parsed = object(option, `setting[${index}].options[${optionIndex}]`);
        return {
          label: string(parsed.label, `setting[${index}].options[${optionIndex}].label`),
          value: string(parsed.value, `setting[${index}].options[${optionIndex}].value`),
        };
      });
      if (options.length === 0 || !options.some((option) => option.value === setting.defaultValue)) {
        throw new Error(`Invalid select setting options for ${id}`);
      }
      return { ...base, type: "select", defaultValue: setting.defaultValue, options };
    }

    throw new Error(`Unsupported or invalid setting type for ${id}`);
  });
}

export function parseRuntimeModuleManifest(value: unknown): RuntimeModuleManifest {
  const manifest = object(value, "manifest");
  const id = string(manifest.id, "module id", 64);
  if (!moduleIdPattern.test(id) || reservedModuleIds.has(id)) throw new Error(`Invalid or reserved module id: ${id}`);
  const version = string(manifest.version, "module version", 64);
  if (!semverPattern.test(version)) throw new Error(`Invalid module version: ${version}`);
  if (manifest.schemaVersion !== RUNTIME_MODULE_SCHEMA_VERSION) throw new Error("Unsupported module schema version.");
  if (manifest.sdkVersion !== RUNTIME_MODULE_SDK_VERSION) throw new Error("Unsupported module SDK version.");

  const entry = string(manifest.entry, "module entry", 100);
  if (entry !== "index.js") throw new Error("V1 module entry must be index.js.");

  return {
    schemaVersion: RUNTIME_MODULE_SCHEMA_VERSION,
    id,
    name: string(manifest.name, "module name"),
    description: string(manifest.description, "module description", 500),
    version,
    hostVersion: string(manifest.hostVersion, "host version range", 100),
    sdkVersion: RUNTIME_MODULE_SDK_VERSION,
    entry,
    navigation: parseNavigation(manifest.navigation ?? [], id),
    settings: parseSettings(manifest.settings ?? []),
  };
}
