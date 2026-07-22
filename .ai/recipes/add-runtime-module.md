# Add a runtime `.mtp` module

Use this path when a feature should update independently from the installed desktop base.

1. Copy `examples/minimal-runtime-module` to a separate module workspace; do not register it in `src/app/module-registry.ts`.
2. Pick a globally unique lowercase kebab-case ID containing at least one hyphen. Every custom element tag must begin with `<module-id>-`.
3. Declare sidebar pages and `switch`/`select` settings only in `manifest.json`. Never edit `App.tsx`, `SettingsPage`, or the base sidebar for a runtime module.
4. Bundle npm/library dependencies into the single ESM entry `index.js`. Declare only dependencies on other installed `.mtp` modules in `manifest.json.dependencies`; never use that field for npm packages.
5. Put hard requirements in `dependencies.required` and non-blocking integrations in `dependencies.optional`. Use semantic version ranges, do not depend on the module itself, and do not repeat an ID across the two lists.
6. Export `activate(hostSdk)` and define every custom element declared by the manifest before activation returns. A dependency only guarantees compatible presence and provider-first activation; it does not expose another module's source or services.
7. Use only `hostSdk.logger`, namespaced `hostSdk.settings`, `hostSdk.theme`, and inherited semantic CSS variables. Do not import base-app source files or call private Tauri commands.
8. Keep cleanup handles in module scope or element instances and release them from `deactivate()`/`disconnectedCallback()`.
9. Increase the module semantic version for every installable update. Installation may succeed while the module waits for missing or incompatible required modules.
10. Run `node scripts/package-runtime-module.mjs <module-directory>` and install the generated `.mtp` from 模块管理.
11. Verify install, dependency waiting/activation order, sidebar routing, settings, theme changes, log source, disable/re-enable, upgrade, rollback, and uninstall safety.

AI guardrail: if the requested feature needs new Rust commands, Tauri plugins, OS permissions, arbitrary file access, or a newer Host SDK, stop treating it as an ordinary runtime module. Propose a separately versioned base capability first.
