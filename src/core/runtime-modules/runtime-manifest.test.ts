import { describe, expect, it } from "vitest";
import { parseRuntimeModuleManifest } from "./runtime-manifest";

const validManifest = {
  schemaVersion: 1,
  id: "hello-module",
  name: "Hello Module",
  description: "A runtime module used by tests",
  version: "1.2.0",
  hostVersion: ">=0.1.0, <0.2.0",
  sdkVersion: 1,
  entry: "index.js",
  navigation: [
    {
      id: "hello-home",
      title: "Hello",
      description: "Runtime page",
      element: "hello-module-home",
      group: "main",
      order: 20,
    },
  ],
  settings: [
    {
      id: "showGreeting",
      type: "switch",
      group: "general",
      label: "Show greeting",
      defaultValue: true,
    },
  ],
};

describe("runtime module manifest", () => {
  it("parses a valid V1 manifest", () => {
    expect(parseRuntimeModuleManifest(validManifest)).toMatchObject({
      id: "hello-module",
      version: "1.2.0",
      navigation: [{ id: "hello-home", element: "hello-module-home" }],
    });
  });

  it("treats a legacy manifest without dependencies as dependency-free", () => {
    expect(parseRuntimeModuleManifest(validManifest)).toMatchObject({
      dependencies: { required: [], optional: [] },
    });
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
    {
      name: "self dependency",
      dependencies: { required: [{ id: "hello-module", version: "^1.0.0" }] },
    },
    {
      name: "duplicate across dependency kinds",
      dependencies: {
        required: [{ id: "data-provider", version: "^1.0.0" }],
        optional: [{ id: "data-provider", version: "^1.0.0" }],
      },
    },
    {
      name: "invalid version range",
      dependencies: { required: [{ id: "data-provider", version: "not a range!" }] },
    },
  ])("rejects $name", ({ dependencies }) => {
    expect(() => parseRuntimeModuleManifest({ ...validManifest, dependencies })).toThrow(/depend/i);
  });

  it.each(["Hello Module", "../escape", "system", "a"])('rejects invalid or reserved module id "%s"', (id) => {
    expect(() => parseRuntimeModuleManifest({ ...validManifest, id })).toThrow(/module id/i);
  });

  it("rejects duplicate navigation ids", () => {
    expect(() => parseRuntimeModuleManifest({
      ...validManifest,
      navigation: [validManifest.navigation[0], validManifest.navigation[0]],
    })).toThrow(/navigation/i);
  });

  it("rejects a custom element that is not namespaced to the module", () => {
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
