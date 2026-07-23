import type { SelectSetting, SwitchSetting } from "@/core/settings/setting-types";
import type { NavigationGroup } from "@/core/features/feature-types";
import { isLocalizedText, type LocalizedText } from "@/core/i18n/localized-text";

export const RUNTIME_MODULE_SCHEMA_VERSION = 2;
export const RUNTIME_MODULE_SDK_VERSION = 12;

export type RuntimeExternalFileAccess = "read" | "write" | "list";
export type RuntimeRegistryAccess = "read" | "read-write";

export interface RuntimeNativeCapabilities {
  filesystem: { private: boolean; external: RuntimeExternalFileAccess[] } | null;
  process: { urlSchemes: string[]; executableGrants: boolean } | null;
  registry: Array<{ hive: "HKCU" | "HKLM"; key: string; access: RuntimeRegistryAccess }>;
  tray: Array<{ id: string; label?: LocalizedText; kind: "button" | "check" | "separator"; order: number }>;
  shortcuts: Array<{ id: string; description: LocalizedText; accelerator: string }>;
  moduleRepository?: { install: true } | null;
  notifications?: { system: true } | null;
  clipboard?: { text: true } | null;
  http?: { origins: string[] } | null;
}

export interface RuntimeNavigationManifest {
  id: string;
  title: LocalizedText;
  description?: LocalizedText;
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

export interface RuntimeModuleServicesManifest {
  provides: string[];
}

export interface RuntimeModuleEventsManifest {
  publishes: string[];
  subscribes: string[];
}

export interface RuntimeModuleManifest {
  schemaVersion: 2;
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  version: string;
  hostVersion: string;
  sdkVersion: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  entry: string;
  dependencies: RuntimeModuleDependencies;
  services?: RuntimeModuleServicesManifest;
  events?: RuntimeModuleEventsManifest;
  navigation: RuntimeNavigationManifest[];
  settings: RuntimeSettingManifest[];
  nativeCapabilities?: RuntimeNativeCapabilities;
}

const moduleIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const contributionIdPattern = /^[A-Za-z][A-Za-z0-9._-]{1,63}$/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const reservedModuleIds = new Set(["system", "logging"]);
const versionRangePattern = /^[0-9A-Za-z.*<>=~^|,\s-]+$/;
const serviceIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

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

function localizedText(value: unknown, label: string, maxLength = 200): LocalizedText {
  if (!isLocalizedText(value)) throw new Error(`${label} must contain non-empty zh-CN and en text only.`);
  if (value["zh-CN"].length > maxLength || value.en.length > maxLength) {
    throw new Error(`${label} translations must be at most ${maxLength} characters.`);
  }
  return { "zh-CN": value["zh-CN"], en: value.en };
}

function optionalLocalizedText(value: unknown, label: string, maxLength = 200) {
  return value === undefined ? undefined : localizedText(value, label, maxLength);
}

function parseNativeCapabilities(value: unknown): RuntimeNativeCapabilities {
  const capabilities = object(value, "nativeCapabilities");
  const allowedKeys = new Set(["filesystem", "process", "registry", "tray", "shortcuts", "moduleRepository", "notifications", "clipboard", "http"]);
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
      label: kind === "separator"
        ? undefined
        : localizedText(item.label, `nativeCapabilities.tray[${index}].label`, 120),
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
      description: localizedText(item.description, `nativeCapabilities.shortcuts[${index}].description`),
      accelerator,
    };
  });
  const moduleRepository = capabilities.moduleRepository == null ? null : (() => {
    const item = object(capabilities.moduleRepository, "nativeCapabilities.moduleRepository");
    if (Object.keys(item).some((key) => key !== "install") || item.install !== true) {
      throw new Error("Invalid native module repository capability.");
    }
    return { install: true as const };
  })();
  const notifications = capabilities.notifications == null ? null : (() => {
    const item = object(capabilities.notifications, "nativeCapabilities.notifications");
    if (Object.keys(item).some((key) => key !== "system") || item.system !== true) {
      throw new Error("Invalid native notifications capability.");
    }
    return { system: true as const };
  })();
  const clipboard = capabilities.clipboard == null ? null : (() => {
    const item = object(capabilities.clipboard, "nativeCapabilities.clipboard");
    if (Object.keys(item).some((key) => key !== "text") || item.text !== true) {
      throw new Error("Invalid native clipboard capability.");
    }
    return { text: true as const };
  })();
  const http = capabilities.http == null ? null : (() => {
    const item = object(capabilities.http, "nativeCapabilities.http");
    if (Object.keys(item).some((key) => key !== "origins") || !Array.isArray(item.origins)) {
      throw new Error("Invalid native http capability.");
    }
    const seen = new Set<string>();
    const origins = item.origins.map((origin: unknown, index: number) => {
      const value = string(origin, `nativeCapabilities.http.origins[${index}]`, 200);
      if (!value.startsWith("https://")) throw new Error(`Invalid http origin: ${value}`);
      if (seen.has(value)) throw new Error(`Duplicate http origin: ${value}`);
      seen.add(value);
      return value;
    });
    return { origins };
  })();
  return { filesystem, process, registry, tray, shortcuts, moduleRepository, notifications, clipboard, http };
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

function parseServices(value: unknown, sdkVersion: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12): RuntimeModuleServicesManifest {
  if (value === undefined) return { provides: [] };
  if (sdkVersion < 4) throw new Error("Module services require Host SDK V4.");
  const services = object(value, "services");
  const unknownKey = Object.keys(services).find((key) => key !== "provides");
  if (unknownKey || !Array.isArray(services.provides)) throw new Error("Invalid module services declaration.");
  const seen = new Set<string>();
  const provides = services.provides.map((value, index) => {
    const id = string(value, `services.provides[${index}]`, 64);
    if (!serviceIdPattern.test(id) || seen.has(id)) throw new Error(`Invalid or duplicate service id: ${id}`);
    seen.add(id);
    return id;
  });
  return { provides };
}

function parseEvents(value: unknown, sdkVersion: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12): RuntimeModuleEventsManifest {
  if (value === undefined) return { publishes: [], subscribes: [] };
  if (sdkVersion < 7) throw new Error("Module events require Host SDK V7.");
  const events = object(value, "events");
  const unknownKey = Object.keys(events).find((key) => key !== "publishes" && key !== "subscribes");
  if (unknownKey) throw new Error(`Invalid module events declaration: unknown key ${unknownKey}.`);

  const parseList = (input: unknown, kind: "publishes" | "subscribes") => {
    if (input === undefined) return [];
    if (!Array.isArray(input)) throw new Error(`events.${kind} must be an array.`);
    const seen = new Set<string>();
    return input.map((item, index) => {
      const id = string(item, `events.${kind}[${index}]`, 64);
      if (!serviceIdPattern.test(id) || seen.has(id)) throw new Error(`Invalid or duplicate event id: ${id}`);
      seen.add(id);
      return id;
    });
  };

  return {
    publishes: parseList(events.publishes, "publishes"),
    subscribes: parseList(events.subscribes, "subscribes"),
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
      title: localizedText(entry.title, `navigation[${index}].title`),
      description: optionalLocalizedText(entry.description, `navigation[${index}].description`, 500),
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
      label: localizedText(setting.label, `setting[${index}].label`),
      description: optionalLocalizedText(setting.description, `setting[${index}].description`, 500),
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
          label: localizedText(parsed.label, `setting[${index}].options[${optionIndex}].label`),
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
  if (manifest.sdkVersion !== 2
    && manifest.sdkVersion !== 3
    && manifest.sdkVersion !== 4
    && manifest.sdkVersion !== 5
    && manifest.sdkVersion !== 6
    && manifest.sdkVersion !== 7
    && manifest.sdkVersion !== 8
    && manifest.sdkVersion !== 9
    && manifest.sdkVersion !== 10
    && manifest.sdkVersion !== 11
    && manifest.sdkVersion !== RUNTIME_MODULE_SDK_VERSION) {
    throw new Error("Unsupported module SDK version.");
  }
  const sdkVersion = manifest.sdkVersion;
  if (sdkVersion < 3 && manifest.nativeCapabilities !== undefined) {
    throw new Error("Native capabilities require Host SDK V3.");
  }
  const nativeCapabilities = sdkVersion >= 3
    ? parseNativeCapabilities(manifest.nativeCapabilities ?? {})
    : undefined;
  if (sdkVersion < 5 && nativeCapabilities?.moduleRepository) {
    throw new Error("Module repository access requires Host SDK V5.");
  }
  if (sdkVersion < 8 && nativeCapabilities?.notifications) {
    throw new Error("Module notifications require Host SDK V8.");
  }
  if (sdkVersion < 10 && nativeCapabilities?.clipboard) {
    throw new Error("Module clipboard access requires Host SDK V10.");
  }
  if (sdkVersion < 12 && nativeCapabilities?.http) {
    throw new Error("Module http proxy requires Host SDK V12.");
  }
  const services = parseServices(manifest.services, sdkVersion);
  const events = parseEvents(manifest.events, sdkVersion);

  const entry = string(manifest.entry, "module entry", 100);
  if (entry !== "index.js") throw new Error("Runtime module entry must be index.js.");

  return {
    schemaVersion: RUNTIME_MODULE_SCHEMA_VERSION,
    id,
    name: localizedText(manifest.name, "module name"),
    description: localizedText(manifest.description, "module description", 500),
    version,
    hostVersion: string(manifest.hostVersion, "host version range", 100),
    sdkVersion,
    entry,
    dependencies: parseDependencies(manifest.dependencies, id),
    services,
    events,
    navigation: parseNavigation(manifest.navigation ?? [], id),
    settings: parseSettings(manifest.settings ?? []),
    nativeCapabilities,
  };
}
