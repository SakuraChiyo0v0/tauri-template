import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_KINDS = new Set(["major", "minor", "patch"]);

function parseVersion(value, label = "version") {
  const match = VERSION_PATTERN.exec(value);
  if (!match) throw new Error(`${label} must be a stable semantic version (x.y.z): ${value}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

export function resolveTargetVersion(currentVersion, requestedVersion) {
  const [major, minor, patch] = parseVersion(currentVersion, "current version");
  let targetVersion = requestedVersion;

  if (RELEASE_KINDS.has(requestedVersion)) {
    targetVersion = requestedVersion === "major"
      ? `${major + 1}.0.0`
      : requestedVersion === "minor"
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`;
  } else {
    parseVersion(requestedVersion, "requested version");
  }

  if (compareVersions(targetVersion, currentVersion) <= 0) {
    throw new Error(`requested version must be greater than ${currentVersion}: ${targetVersion}`);
  }
  return targetVersion;
}

function packageSection(content, fileName) {
  const start = content.search(/^\[package\]\s*$/m);
  if (start < 0) throw new Error(`${fileName} is missing [package]`);
  const afterHeader = content.indexOf("\n", start);
  const nextSectionOffset = content.slice(afterHeader + 1).search(/^\[/m);
  const end = nextSectionOffset < 0 ? content.length : afterHeader + 1 + nextSectionOffset;
  return { start, end, content: content.slice(start, end) };
}

function readTomlVersion(content, fileName) {
  const section = packageSection(content, fileName).content;
  const match = /^version\s*=\s*"([^"]+)"\s*$/m.exec(section);
  if (!match) throw new Error(`${fileName} [package] is missing version`);
  return match[1];
}

function replaceTomlVersion(content, fileName, version) {
  const section = packageSection(content, fileName);
  const replaced = section.content.replace(
    /^(version\s*=\s*")[^"]+("\s*)$/m,
    `$1${version}$2`,
  );
  if (replaced === section.content) throw new Error(`${fileName} [package] version could not be updated`);
  return content.slice(0, section.start) + replaced + content.slice(section.end);
}

function cargoLockPackage(content, packageName) {
  const blocks = content.split(/(?=^\[\[package\]\]\r?$)/m);
  const index = blocks.findIndex((block) => new RegExp(`^name\\s*=\\s*"${packageName}"\\s*$`, "m").test(block));
  if (index < 0) throw new Error(`Cargo.lock is missing package ${packageName}`);
  const versionMatch = /^version\s*=\s*"([^"]+)"\s*$/m.exec(blocks[index]);
  if (!versionMatch) throw new Error(`Cargo.lock package ${packageName} is missing version`);
  return { blocks, index, version: versionMatch[1] };
}

function replaceCargoLockVersion(content, packageName, version) {
  const entry = cargoLockPackage(content, packageName);
  entry.blocks[entry.index] = entry.blocks[entry.index].replace(
    /^(version\s*=\s*")[^"]+("\s*)$/m,
    `$1${version}$2`,
  );
  return entry.blocks.join("");
}

async function readProjectFiles(root) {
  const paths = {
    packageJson: path.join(root, "package.json"),
    cargoToml: path.join(root, "src-tauri", "Cargo.toml"),
    tauriConfig: path.join(root, "src-tauri", "tauri.conf.json"),
    cargoLock: path.join(root, "src-tauri", "Cargo.lock"),
    changelog: path.join(root, "CHANGELOG.md"),
  };
  const [packageContent, cargoToml, tauriContent, cargoLock, changelog] = await Promise.all([
    readFile(paths.packageJson, "utf8"),
    readFile(paths.cargoToml, "utf8"),
    readFile(paths.tauriConfig, "utf8"),
    readFile(paths.cargoLock, "utf8"),
    readFile(paths.changelog, "utf8"),
  ]);
  const packageJson = JSON.parse(packageContent);
  const tauriConfig = JSON.parse(tauriContent);
  const packageName = packageJson.name;
  if (typeof packageName !== "string" || packageName.length === 0) throw new Error("package.json is missing name");

  return {
    paths,
    packageJson,
    packageContent,
    cargoToml,
    tauriConfig,
    tauriContent,
    cargoLock,
    changelog,
    packageName,
    versions: {
      "package.json": packageJson.version,
      "Cargo.toml": readTomlVersion(cargoToml, "Cargo.toml"),
      "tauri.conf.json": tauriConfig.version,
      "Cargo.lock": cargoLockPackage(cargoLock, packageName).version,
    },
  };
}

function synchronizedVersion(files) {
  const entries = Object.entries(files.versions);
  for (const [fileName, version] of entries) parseVersion(version, `${fileName} version`);
  const versions = new Set(entries.map(([, version]) => version));
  if (versions.size !== 1) {
    throw new Error(`Project versions are not synchronized: ${entries.map(([name, version]) => `${name}=${version}`).join(", ")}`);
  }
  return entries[0][1];
}

export async function checkProjectVersion(root) {
  return synchronizedVersion(await readProjectFiles(root));
}

export async function bumpProjectVersion(root, requestedVersion) {
  const files = await readProjectFiles(root);
  const previousVersion = synchronizedVersion(files);
  const version = resolveTargetVersion(previousVersion, requestedVersion);
  const escapedVersion = version.replaceAll(".", "\\.");
  if (!new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").test(files.changelog)) {
    throw new Error(`CHANGELOG.md is missing a dated [${version}] release entry`);
  }

  const packageJson = { ...files.packageJson, version };
  const tauriConfig = { ...files.tauriConfig, version };
  const updates = [
    [files.paths.packageJson, `${JSON.stringify(packageJson, null, 2)}\n`],
    [files.paths.cargoToml, replaceTomlVersion(files.cargoToml, "Cargo.toml", version)],
    [files.paths.tauriConfig, `${JSON.stringify(tauriConfig, null, 2)}\n`],
    [files.paths.cargoLock, replaceCargoLockVersion(files.cargoLock, files.packageName, version)],
  ];
  await Promise.all(updates.map(([filePath, content]) => writeFile(filePath, content)));
  return { previousVersion, version };
}

async function runCli() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [command, argument] = process.argv.slice(2);
  if (command === "check" && argument === undefined) {
    console.log(`Project version ${await checkProjectVersion(root)} is synchronized.`);
    return;
  }
  if (command === "bump" && argument) {
    const result = await bumpProjectVersion(root, argument);
    console.log(`Project version updated: ${result.previousVersion} -> ${result.version}`);
    return;
  }
  throw new Error("Usage: node scripts/version.mjs check | bump <major|minor|patch|x.y.z>");
}

const executablePath = process.argv[1] ? path.resolve(process.argv[1]).toLowerCase() : "";
if (executablePath === fileURLToPath(import.meta.url).toLowerCase()) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
