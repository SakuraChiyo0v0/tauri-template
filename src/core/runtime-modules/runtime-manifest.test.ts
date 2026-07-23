import { describe, expect, it } from "vitest";
import { parseRuntimeModuleManifest } from "./runtime-manifest";

const text = (zhCN: string, en = zhCN) => ({ "zh-CN": zhCN, en });

const validManifest = {
  schemaVersion: 2,
  id: "hello-module",
  name: text("问候模块", "Hello Module"),
  description: text("用于测试的运行时模块", "A runtime module used by tests"),
  version: "1.2.0",
  hostVersion: ">=0.2.0, <0.3.0",
  sdkVersion: 2,
  entry: "index.js",
  dependencies: { required: [], optional: [] },
  navigation: [{
    id: "hello-home",
    title: text("问候", "Hello"),
    description: text("运行时页面", "Runtime page"),
    element: "hello-module-home",
    group: "main",
    order: 20,
  }],
  settings: [{
    id: "showGreeting",
    type: "switch",
    group: "general",
    label: text("显示问候", "Show greeting"),
    defaultValue: true,
  }],
};

describe("runtime module manifest", () => {
  it("parses a complete bilingual schema V2 manifest", () => {
    expect(parseRuntimeModuleManifest(validManifest)).toMatchObject({
      schemaVersion: 2,
      sdkVersion: 2,
      name: { "zh-CN": "问候模块", en: "Hello Module" },
      navigation: [{ id: "hello-home", title: { "zh-CN": "问候", en: "Hello" } }],
    });
  });

  it.each([
    { path: "module name", value: { ...validManifest, name: { "zh-CN": "问候模块" } } },
    { path: "module description", value: { ...validManifest, description: text("说明", "  ") } },
    {
      path: "navigation title",
      value: { ...validManifest, navigation: [{ ...validManifest.navigation[0], title: { en: "Hello" } }] },
    },
    {
      path: "setting label",
      value: { ...validManifest, settings: [{ ...validManifest.settings[0], label: { "zh-CN": "显示" } }] },
    },
  ])("rejects incomplete bilingual $path", ({ value }) => {
    expect(() => parseRuntimeModuleManifest(value)).toThrow(/zh-CN.*en/i);
  });

  it("rejects schema V1 and Host SDK V1", () => {
    expect(() => parseRuntimeModuleManifest({ ...validManifest, schemaVersion: 1 })).toThrow(/schema version/i);
    expect(() => parseRuntimeModuleManifest({ ...validManifest, sdkVersion: 1 })).toThrow(/SDK version/i);
  });

  it("accepts Host SDK V3 with bilingual native contributions", () => {
    expect(parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion: 3,
      nativeCapabilities: {
        filesystem: { private: true, external: ["read"] },
        process: { urlSchemes: ["https"], executableGrants: false },
        registry: [],
        tray: [{ id: "open", label: text("打开", "Open"), kind: "button", order: 1 }],
        shortcuts: [{ id: "show", description: text("显示窗口", "Show window"), accelerator: "Ctrl+Shift+M" }],
      },
    })).toMatchObject({
      sdkVersion: 3,
      nativeCapabilities: {
        tray: [{ label: { "zh-CN": "打开", en: "Open" } }],
        shortcuts: [{ description: { "zh-CN": "显示窗口", en: "Show window" } }],
      },
    });
  });

  it("accepts Host SDK V4 with declared services", () => {
    expect(parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion: 4,
      services: { provides: ["notes.v1"] },
    })).toMatchObject({
      sdkVersion: 4,
      services: { provides: ["notes.v1"] },
    });
  });

  it("accepts Host SDK V5 with module repository install access", () => {
    expect(parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion: 5,
      services: { provides: [] },
      nativeCapabilities: {
        filesystem: { private: false, external: ["read", "list"] },
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        moduleRepository: { install: true },
      },
    })).toMatchObject({
      sdkVersion: 5,
      nativeCapabilities: { moduleRepository: { install: true } },
    });
  });

  it("accepts Host SDK V6 while keeping module repository permissions explicit", () => {
    expect(parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion: 6,
      services: { provides: [] },
      nativeCapabilities: {
        filesystem: { private: false, external: ["read", "list"] },
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        moduleRepository: { install: true },
      },
    })).toMatchObject({
      sdkVersion: 6,
      nativeCapabilities: { moduleRepository: { install: true } },
    });
  });

  it("rejects module repository access before Host SDK V5", () => {
    expect(() => parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion: 4,
      nativeCapabilities: { moduleRepository: { install: true } },
    })).toThrow(/Host SDK V5/i);
  });

  it("accepts Host SDK V7 with declared events", () => {
    expect(parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion: 7,
      events: { publishes: ["notes.changed.v1"], subscribes: ["notes.changed.v1", "market.updated.v1"] },
    })).toMatchObject({
      sdkVersion: 7,
      events: { publishes: ["notes.changed.v1"], subscribes: ["notes.changed.v1", "market.updated.v1"] },
    });
  });

  it("defaults to empty event declarations when omitted", () => {
    expect(parseRuntimeModuleManifest({ ...validManifest, sdkVersion: 7 })).toMatchObject({
      sdkVersion: 7,
      events: { publishes: [], subscribes: [] },
    });
  });

  it.each([
    { name: "events on SDK V6", sdkVersion: 6, events: { publishes: ["notes.changed.v1"] } },
    { name: "duplicate published event", sdkVersion: 7, events: { publishes: ["notes.changed.v1", "notes.changed.v1"] } },
    { name: "duplicate subscribed event", sdkVersion: 7, events: { subscribes: ["notes.changed.v1", "notes.changed.v1"] } },
    { name: "invalid event id", sdkVersion: 7, events: { subscribes: ["Invalid Event"] } },
    { name: "unknown events key", sdkVersion: 7, events: { streams: ["notes.changed.v1"] } },
  ])("rejects $name", ({ sdkVersion, events }) => {
    expect(() => parseRuntimeModuleManifest({ ...validManifest, sdkVersion, events })).toThrow(/event/i);
  });

  it.each([
    { name: "services on SDK V3", sdkVersion: 3, services: { provides: ["notes.v1"] } },
    { name: "duplicate service", sdkVersion: 4, services: { provides: ["notes.v1", "notes.v1"] } },
    { name: "invalid service id", sdkVersion: 4, services: { provides: ["Notes Service"] } },
  ])("rejects $name", ({ sdkVersion, services }) => {
    expect(() => parseRuntimeModuleManifest({ ...validManifest, sdkVersion, services })).toThrow(/service/i);
  });

  it("rejects native capabilities on SDK V2", () => {
    expect(() => parseRuntimeModuleManifest({
      ...validManifest,
      nativeCapabilities: { filesystem: { private: true, external: [] } },
    })).toThrow(/native capabilities/i);
  });

  it("accepts Host SDK V8 with declared notifications capability", () => {
    expect(parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion: 8,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: {
        filesystem: null,
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        notifications: { system: true },
      },
    })).toMatchObject({
      sdkVersion: 8,
      nativeCapabilities: { notifications: { system: true } },
    });
  });

  it("accepts Host SDK V9 without requiring new native capabilities", () => {
    expect(parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion: 9,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: {
        filesystem: null,
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        notifications: { system: true },
      },
    })).toMatchObject({ sdkVersion: 9 });
  });

  it("accepts Host SDK V11", () => {
    expect(parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion: 11,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: {
        filesystem: null,
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        notifications: { system: true },
        clipboard: { text: true },
      },
    })).toMatchObject({ sdkVersion: 11 });
  });

  it("accepts Host SDK V12 with http capability", () => {
    expect(parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion: 12,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: {
        filesystem: null,
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        notifications: { system: true },
        clipboard: { text: true },
        http: { origins: ["https://api.example.com"] },
      },
    })).toMatchObject({ sdkVersion: 12, nativeCapabilities: { http: { origins: ["https://api.example.com"] } } });
  });

  it.each([
    { name: "http on SDK V11", sdkVersion: 11, nativeCapabilities: { http: { origins: ["https://api.example.com"] } } },
    { name: "non-https http origin", sdkVersion: 12, nativeCapabilities: { http: { origins: ["http://api.example.com"] } } },
    { name: "duplicate http origin", sdkVersion: 12, nativeCapabilities: { http: { origins: ["https://a.example.com", "https://a.example.com"] } } },
  ])("rejects $name", ({ sdkVersion, nativeCapabilities }) => {
    expect(() => parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: { filesystem: null, process: null, registry: [], tray: [], shortcuts: [], notifications: { system: true }, clipboard: { text: true }, ...nativeCapabilities },
    })).toThrow(/http|SDK V12/i);
  });

  it("accepts Host SDK V10 with clipboard capability", () => {
    expect(parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion: 10,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: {
        filesystem: null,
        process: null,
        registry: [],
        tray: [],
        shortcuts: [],
        notifications: { system: true },
        clipboard: { text: true },
      },
    })).toMatchObject({ sdkVersion: 10, nativeCapabilities: { clipboard: { text: true } } });
  });

  it.each([
    { name: "clipboard on SDK V9", sdkVersion: 9, nativeCapabilities: { clipboard: { text: true } } },
    { name: "invalid clipboard flag", sdkVersion: 10, nativeCapabilities: { clipboard: { text: false } } },
  ])("rejects $name", ({ sdkVersion, nativeCapabilities }) => {
    expect(() => parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: { filesystem: null, process: null, registry: [], tray: [], shortcuts: [], notifications: { system: true }, ...nativeCapabilities },
    })).toThrow(/clipboard|SDK V10/i);
  });

  it.each([
    { name: "notifications on SDK V7", sdkVersion: 7, nativeCapabilities: { notifications: { system: true } } },
    { name: "invalid notifications flag", sdkVersion: 8, nativeCapabilities: { notifications: { system: false } } },
    { name: "unknown notifications key", sdkVersion: 8, nativeCapabilities: { notifications: { sound: true } } },
  ])("rejects $name", ({ sdkVersion, nativeCapabilities }) => {
    expect(() => parseRuntimeModuleManifest({
      ...validManifest,
      sdkVersion,
      services: { provides: [] },
      events: { publishes: [], subscribes: [] },
      nativeCapabilities: { filesystem: null, process: null, registry: [], tray: [], shortcuts: [], ...nativeCapabilities },
    })).toThrow(/notifications|SDK V8/i);
  });

  it("preserves required and optional dependency ranges", () => {
    expect(parseRuntimeModuleManifest({
      ...validManifest,
      dependencies: {
        required: [{ id: "data-provider", version: "^1.2.0" }],
        optional: [{ id: "export-tools", version: ">=1.0.0, <2.0.0" }],
      },
    })).toMatchObject({
      dependencies: {
        required: [{ id: "data-provider", version: "^1.2.0" }],
        optional: [{ id: "export-tools", version: ">=1.0.0, <2.0.0" }],
      },
    });
  });

  it.each([
    { name: "self dependency", dependencies: { required: [{ id: "hello-module", version: "^1.0.0" }] } },
    {
      name: "duplicate across dependency kinds",
      dependencies: {
        required: [{ id: "data-provider", version: "^1.0.0" }],
        optional: [{ id: "data-provider", version: "^1.0.0" }],
      },
    },
    { name: "invalid version range", dependencies: { required: [{ id: "data-provider", version: "not a range!" }] } },
  ])("rejects $name", ({ dependencies }) => {
    expect(() => parseRuntimeModuleManifest({ ...validManifest, dependencies })).toThrow(/depend/i);
  });

  it.each(["Hello Module", "../escape", "system", "a"])('rejects invalid or reserved module id "%s"', (id) => {
    expect(() => parseRuntimeModuleManifest({ ...validManifest, id })).toThrow(/module id/i);
  });

  it("rejects duplicate navigation ids and unnamespaced elements", () => {
    expect(() => parseRuntimeModuleManifest({
      ...validManifest,
      navigation: [validManifest.navigation[0], validManifest.navigation[0]],
    })).toThrow(/navigation/i);
    expect(() => parseRuntimeModuleManifest({
      ...validManifest,
      navigation: [{ ...validManifest.navigation[0], element: "other-module-home" }],
    })).toThrow(/custom element/i);
  });

  it("rejects unsupported custom settings", () => {
    expect(() => parseRuntimeModuleManifest({
      ...validManifest,
      settings: [{ ...validManifest.settings[0], type: "custom" }],
    })).toThrow(/setting/i);
  });
});
