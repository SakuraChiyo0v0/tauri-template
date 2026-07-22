import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bumpProjectVersion,
  checkProjectVersion,
  resolveTargetVersion,
} from "./version.mjs";

const temporaryDirectories = [];

async function projectFixture({
  packageVersion = "0.1.0",
  cargoVersion = packageVersion,
  tauriVersion = packageVersion,
  lockVersion = packageVersion,
  changelogVersions = ["0.2.0", "0.1.0"],
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "modular-tauri-version-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "src-tauri"), { recursive: true });
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: "modular-tauri-template",
    version: packageVersion,
  }, null, 2)}\n`);
  await writeFile(path.join(root, "src-tauri", "Cargo.toml"), [
    "[package]",
    'name = "modular-tauri-template"',
    `version = "${cargoVersion}"`,
    'edition = "2024"',
    "",
  ].join("\n"));
  await writeFile(path.join(root, "src-tauri", "tauri.conf.json"), `${JSON.stringify({
    productName: "Modular Tauri Template",
    version: tauriVersion,
  }, null, 2)}\n`);
  await writeFile(path.join(root, "src-tauri", "Cargo.lock"), [
    "version = 4",
    "",
    "[[package]]",
    'name = "modular-tauri-template"',
    `version = "${lockVersion}"`,
    "dependencies = []",
    "",
    "[[package]]",
    'name = "unrelated"',
    'version = "9.9.9"',
    "",
  ].join("\n"));
  await writeFile(path.join(root, "CHANGELOG.md"), [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    ...changelogVersions.flatMap((version) => [`## [${version}] - 2026-07-22`, ""]),
  ].join("\n"));
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("resolveTargetVersion", () => {
  it.each([
    ["major", "1.0.0"],
    ["minor", "0.2.0"],
    ["patch", "0.1.1"],
    ["0.3.0", "0.3.0"],
  ])("resolves %s from 0.1.0", (input, expected) => {
    expect(resolveTargetVersion("0.1.0", input)).toBe(expected);
  });

  it.each(["invalid", "v0.2.0", "0.1.0", "0.0.9", "1.0.0-beta.1"])("rejects %s", (input) => {
    expect(() => resolveTargetVersion("0.1.0", input)).toThrow();
  });
});

describe("project version files", () => {
  it("updates npm, Cargo, Tauri, and the root Cargo.lock package together", async () => {
    const root = await projectFixture();

    const result = await bumpProjectVersion(root, "minor");

    expect(result).toEqual({ previousVersion: "0.1.0", version: "0.2.0" });
    await expect(checkProjectVersion(root)).resolves.toBe("0.2.0");
    expect(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version).toBe("0.2.0");
    expect(JSON.parse(await readFile(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")).version).toBe("0.2.0");
    expect(await readFile(path.join(root, "src-tauri", "Cargo.toml"), "utf8")).toContain('version = "0.2.0"');
    const cargoLock = await readFile(path.join(root, "src-tauri", "Cargo.lock"), "utf8");
    expect(cargoLock).toContain('name = "modular-tauri-template"\nversion = "0.2.0"');
    expect(cargoLock).toContain('name = "unrelated"\nversion = "9.9.9"');
  });

  it("reports every managed location when versions drift", async () => {
    const root = await projectFixture({ cargoVersion: "0.1.1" });

    await expect(checkProjectVersion(root)).rejects.toThrow(/package\.json=0\.1\.0.*Cargo\.toml=0\.1\.1.*tauri\.conf\.json=0\.1\.0.*Cargo\.lock=0\.1\.0/s);
  });

  it("rejects a target without a changelog entry before modifying files", async () => {
    const root = await projectFixture({ changelogVersions: ["0.1.0"] });
    const before = await readFile(path.join(root, "package.json"), "utf8");

    await expect(bumpProjectVersion(root, "minor")).rejects.toThrow(/CHANGELOG/);
    expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(before);
  });

  it("rejects version drift before modifying files", async () => {
    const root = await projectFixture({ tauriVersion: "0.1.1" });
    const before = await readFile(path.join(root, "src-tauri", "Cargo.toml"), "utf8");

    await expect(bumpProjectVersion(root, "minor")).rejects.toThrow(/not synchronized/);
    expect(await readFile(path.join(root, "src-tauri", "Cargo.toml"), "utf8")).toBe(before);
  });
});
