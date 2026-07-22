import type { SelectSetting, SwitchSetting } from "@/core/settings/setting-types";
import type { NavigationGroup } from "@/core/features/feature-types";

export const RUNTIME_MODULE_SCHEMA_VERSION = 1;
export const RUNTIME_MODULE_SDK_VERSION = 3;

export type RuntimeExternalFileAccess = "read" | "write" | "list";
export type RuntimeRegistryAccess = "read" | "read-write";

export interface RuntimeNativeCapabilities {
  filesystem: { private: boolean; external: RuntimeExternalFileAccess[] } | null;
  process: { urlSchemes: string[]; executableGrants: boolean } | null;
  registry: Array<{ hive: "HKCU" | "HKLM"; key: string; access: RuntimeRegistryAccess }>;
  tray: Array<{ id: string; label: string; kind: "button" | "check" | "separator"; order: number }>;
  shortcuts: Array<{ id: string; description: string; accelerator: string }>;
}

export interface RuntimeNavigationManifest {
  id: string;
  title: string;
  description?: string;
  element: string;
  group?: NavigationGroup;
  order?: number;
}

export type RuntimeSettingManifest = SwitchSetting | SelectSetting;

export interface RuntimeModuleDependency {
  id: string;
  version: string;
}

export interface RuntimeModuleDependencies {
  required: RuntimeModuleDependency[];
  optional: RuntimeModuleDependency[];
}

export interface RuntimeModuleManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  hostVersion: string;
  sdkVersion: 1 | 2 | 3;
  entry: string;
  dependencies: RuntimeModuleDependencies;
  navigation: RuntimeNavigationManifest[];
  settings: RuntimeSettingManifest[];
  nativeCapabilities?: RuntimeNativeCapabilities;
}

const moduleIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const contributionIdPattern = /^[A-Za-z][A-Za-z0-9._-]{1,63}$/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const reservedModuleIds = new Set(["system", "logging"]);
const versionRangePattern = /^[0-9A-Za-z.*<>=~^|,\s-]+$/;

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

function parseNativeCapabilities(value: unknown): RuntimeNativeCapabilities {
  const capabilities = object(value, "nativeCapabilities");
  const allowedKeys = new Set(["filesystem", "process", "registry", "tray", "shortcuts"]);
  const unknownKey = Object.keys(capabilities).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unknown native capability: ${unknownKey}`);

  const filesystem = capabilities.filesystem == null ? null : (() => {
    const item = object(capabilities.filesystem, "nativeCapabilities.filesystem");
    const external = item.external ?? [];
    if (typeof item.private !== "boolean" || !Array.isArray(external)
      || external.some((access) => !["read", "write", "list"].includes(String(access)))) {
      throw new Error("Invalid native filesystem capabilities.");
    }
    return { private: item.private, external: [...new Set(external)] as RuntimeExternalFileAccess[] };
  })();

  const process = capabilities.process == null ? null : (() => {
    const item = object(capabilities.process, "nativeCapabilities.process");
    const urlSchemes = item.urlSchemes ?? [];
    if (!Array.isArray(urlSchemes) || typeof item.executableGrants !== "boolean") {
      throw new Error("Invalid native process capabilities.");
    }
    const schemes = urlSchemes.map((value, index) => string(value, `nativeCapabilities.process.urlSchemes[${index}]`, 32).toLowerCase());
    if (schemes.some((scheme) => !/^[a-z][a-z0-9+.-]*$/.test(scheme)
      || ["file", "javascript", "data", "shell", "powershell", "cmd"].includes(scheme))) {
      throw new Error("Invalid or unsafe URL scheme.");
    }
    return { urlSchemes: [...new Set(schemes)].sort(), executableGrants: item.executableGrants };
  })();

  const parseArray = (input: unknown, label: string) => {
    if (input === undefined) return [];
    if (!Array.isArray(input)) throw new Error(`${label} must be an array.`);
    return input;
  };
  const registry = parseArray(capabilities.registry, "nativeCapabilities.registry").map((value, index) => {
    const item = object(value, `nativeCapabilities.registry[${index}]`);
    if ((item.hive !== "HKCU" && item.hive !== "HKLM")
      || (item.access !== "read" && item.access !== "read-write")
      || (item.hive === "HKLM" && item.access === "read-write")) {
      throw new Error("Invalid native registry capability.");
    }
    const hive = item.hive as "HKCU" | "HKLM";
    const access = item.access as RuntimeRegistryAccess;
    const key = string(item.key, `nativeCapabilities.registry[${index}].key`, 512).replace(/\//g, "\\");
    if (key.split("\\").some((part) => !part || part === "." || part === "..")) {
      throw new Error("Invalid native registry key.");
    }
    return { hive, key, access };
  });
  const tray = parseArray(capabilities.tray, "nativeCapabilities.tray").map((value, index) => {
    const item = object(value, `nativeCapabilities.tray[${index}]`);
    const kind = item.kind as "button" | "check" | "separator";
    if (kind !== "button" && kind !== "check" && kind !== "separator") throw new Error("Invalid tray item kind.");
    if (typeof item.order !== "number" || !Number.isInteger(item.order)) throw new Error("Invalid tray item order.");
    return {
      id: string(item.id, `nativeCapabilities.tray[${index}].id`, 64),
      label: kind === "separator" ? String(item.label ?? "") : string(item.label, `nativeCapabilities.tray[${index}].label`, 120),
      kind,
      order: item.order,
    };
  });
  const shortcuts = parseArray(capabilities.shortcuts, "nativeCapabilities.shortcuts").map((value, index) => {
    const item = object(value, `nativeCapabilities.shortcuts[${index}]`);
    const accelerator = string(item.accelerator, `nativeCapabilities.shortcuts[${index}].accelerator`, 64);
    if (!accelerator.includes("+")) throw new Error("Invalid shortcut accelerator.");
    return {
      id: string(item.id, `nativeCapabilities.shortcuts[${index}].id`, 64),
      description: string(item.description, `nativeCapabilities.shortcuts[${index}].description`),
      accelerator,
    };
  });
  return { filesystem, process, registry, tray, shortcuts };
}

function parseDependencies(value: unknown, moduleId: string): RuntimeModuleDependencies {
  if (value === undefined) return { required: [], optional: [] };
  const dependencies = object(value, "dependencies");
  const seen = new Set<string>();

  const parseList = (input: unknown, kind: "required" | "optional") => {
    if (input === undefined) return [];
    if (!Array.isArray(input)) throw new Error(`dependencies.${kind} must be an array.`);
    return input.map((item, index) => {
      const dependency = object(item, `dependencies.${kind}[${index}]`);
      const id = string(dependency.id, `dependencies.${kind}[${index}].id`, 64);
      if (!moduleIdPattern.test(id) || reservedModuleIds.has(id) || id === moduleId || seen.has(id)) {
        throw new Error(`Invalid, self, or duplicate dependency id: ${id}`);
      }
      seen.add(id);
      const version = string(dependency.version, `dependencies.${kind}[${index}].version`, 100);
      if (!versionRangePattern.test(version) || !/\d/.test(version)) {
        throw new Error(`Invalid dependency version range for ${id}: ${version}`);
      }
      return { id, version };
    });
  };

  return {
    required: parseList(dependencies.required, "required"),
    optional: parseList(dependencies.optional, "optional"),
  };
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
  if (manifest.sdkVersion !== 1 && manifest.sdkVersion !== 2 && manifest.sdkVersion !== RUNTIME_MODULE_SDK_VERSION) {
    throw new Error("Unsupported module SDK version.");
  }
  const sdkVersion = manifest.sdkVersion;
  if (sdkVersion < 3 && manifest.nativeCapabilities !== undefined) {
    throw new Error("Native capabilities require Host SDK V3.");
  }
  const nativeCapabilities = sdkVersion === 3
    ? parseNativeCapabilities(manifest.nativeCapabilities ?? {})
    : undefined;

  const entry = string(manifest.entry, "module entry", 100);
  if (entry !== "index.js") throw new Error("Runtime module entry must be index.js.");

  return {
    schemaVersion: RUNTIME_MODULE_SCHEMA_VERSION,
    id,
    name: string(manifest.name, "module name"),
    description: string(manifest.description, "module description", 500),
    version,
    hostVersion: string(manifest.hostVersion, "host version range", 100),
    sdkVersion,
    entry,
    dependencies: parseDependencies(manifest.dependencies, id),
    navigation: parseNavigation(manifest.navigation ?? [], id),
    settings: parseSettings(manifest.settings ?? []),
    nativeCapabilities,
  };
}
