# Feature module rules

Each direct child directory is a removable source module.

- Export a `defineFeature(...)` manifest from `index.ts`.
- Keep module components, hooks, services, types, tests, and optional native bridge together.
- Register the module once in `src/app/module-registry.ts`.
- Declare sidebar pages through `navigation` with globally unique IDs, a Lucide icon, `group`, and `order`.
- Keep page title and description in the navigation contribution so the shared content header stays consistent.
- Declare settings in the manifest with a stable `id`, `group`, and `order`.
- Use data-driven `switch` or `select` settings when possible; use `custom` only for genuinely complex UI.
- Store settings through `core/settings`; keys are automatically namespaced by module ID.
- Do not edit `SettingsPage` to install a setting.
- Do not edit `App.tsx` to install a page or sidebar item.
- If native code is required, mirror the module under `src-tauri/src/features` and document every Rust registration needed for removal.
