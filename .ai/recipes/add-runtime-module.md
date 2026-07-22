# Add a runtime `.mtp` module

Use this path when a feature should update independently from the installed desktop base.

1. Start from the independent `tauri-module-template` repository. Keep it outside the desktop base checkout and never register it in `src/app/module-registry.ts`.
2. Pick a globally unique lowercase kebab-case ID containing at least one hyphen. Every custom element tag must begin with `<module-id>-`.
3. Use schema V2 and provide non-empty `zh-CN` and `en` values for every host-rendered name, description, navigation label, setting label/option, tray label, and shortcut description. Declare sidebar pages and `switch`/`select` settings only in `manifest.json`.
4. Bundle npm/library dependencies into the single ESM entry `index.js`. Declare only dependencies on other installed `.mtp` modules in `manifest.json.dependencies`; never use that field for npm packages.
5. Put hard requirements in `dependencies.required` and non-blocking integrations in `dependencies.optional`. Use semantic version ranges, do not depend on the module itself, and do not repeat an ID across the two lists.
6. Export `activate(hostSdk)` and define every custom element declared by the manifest before activation returns. A dependency only guarantees compatible presence and provider-first activation; it does not expose another module's source or services.
7. Use only the Host SDK version declared by the manifest. V2 is the minimum and provides logger, namespaced settings, theme, i18n and module-isolated SQLite; V3 adds session-bound filesystem, process, registry, tray and shortcut proxies. Schema V1 and Host SDK V1 are unsupported.
8. For V3, declare the smallest `nativeCapabilities` set that the module actually uses. Use private relative paths and opaque file grants; pass only a readable file grant ID to `process.openPath()` / `process.revealInFolder()` and only an executable grant ID to `process.run()`. Never request broad paths, Shell execution, elevation or raw registry access.
9. Keep module-owned Chinese and English page messages in the module. Render from `hostSdk.i18n.getLocale()`, subscribe for immediate language changes, and release that subscription together with other cleanup handles from `deactivate()`/`disconnectedCallback()`.
10. Increase the module semantic version for every installable update. Installation may succeed while the module waits for dependencies or native permission approval.
11. Run `pnpm check` and `pnpm module:pack` inside the module repository, then install the generated `.mtp` from 模块管理.
12. Verify install, permission review, dependency waiting/activation order, sidebar routing, settings, theme changes, log source, native capability denial, disable/re-enable, upgrade, rollback, revocation and uninstall cleanup.

AI guardrail: if the requested feature needs new Rust commands, Tauri plugins, OS permissions, arbitrary file access, or a newer Host SDK, stop treating it as an ordinary runtime module. Propose a separately versioned base capability first.

Permission guardrail: a V3 module can use only the declared and user-approved capability set. A permission-expanding update must wait for fresh approval. Do not work around denial by importing `@tauri-apps/api`, discovering filesystem paths, spawning a shell, or reaching into another module.

The desktop base intentionally contains no installable runtime module example or module packer. Do not copy module source, `build/`, `dist/`, or `.mtp` artifacts back into this repository.

Database guardrail: use parameter placeholders for values, keep migrations behind `getUserVersion()`/`setUserVersion()`, and use `transaction()` for atomic schema/data changes. Do not use `ATTACH`, PRAGMA, extension loading, filesystem paths, or another module's table layout. Share data later through a versioned module service rather than direct SQL coupling.
