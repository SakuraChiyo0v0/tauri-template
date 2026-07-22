# Add a runtime `.mtp` module

Use this path when a feature should update independently from the installed desktop base.

1. Copy `examples/minimal-runtime-module` to a separate module workspace; do not register it in `src/app/module-registry.ts`.
2. Pick a globally unique lowercase kebab-case ID containing at least one hyphen. Every custom element tag must begin with `<module-id>-`.
3. Declare sidebar pages and `switch`/`select` settings only in `manifest.json`. Never edit `App.tsx`, `SettingsPage`, or the base sidebar for a runtime module.
4. Bundle all JavaScript dependencies into the single ESM entry `index.js`. Export `activate(hostSdk)` and define every custom element declared by the manifest before activation returns.
5. Use only `hostSdk.logger`, namespaced `hostSdk.settings`, `hostSdk.theme`, and inherited semantic CSS variables. Do not import base-app source files or call private Tauri commands.
6. Keep cleanup handles in module scope or element instances and release them from `deactivate()`/`disconnectedCallback()`.
7. Increase the module semantic version for every installable update. The base intentionally rejects duplicate or lower-version installs.
8. Run `node scripts/package-runtime-module.mjs <module-directory>` and install the generated `.mtp` from 模块管理.
9. Verify install, sidebar routing, settings, theme changes, log source, disable/re-enable, upgrade, rollback, and uninstall.

AI guardrail: if the requested feature needs new Rust commands, Tauri plugins, OS permissions, arbitrary file access, or a newer Host SDK, stop treating it as an ordinary runtime module. Propose a separately versioned base capability first.
