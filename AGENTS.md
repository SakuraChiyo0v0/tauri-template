# Modular Tauri Template rules

Read this file before changing the project. Keep the template free of demo business features.

## Architecture

- `src/components/ui` contains reusable, business-neutral UI primitives.
- `src/themes` owns semantic design tokens and theme selection.
- `src/core` owns stable extension contracts and persistence helpers.
- `src/features/<feature>` owns one removable feature and its settings contributions.
- `src/app/module-registry.ts` is the only frontend module installation list.
- The application shell renders navigation contributed by enabled modules; it never imports feature pages directly.
- `src-tauri/src/features` mirrors features that need native Rust behavior.

## Change rules

- Add business capabilities as feature modules; do not place them in `App.tsx`, settings pages, or UI primitives.
- A feature must export one `defineFeature(...)` manifest from its `index.ts`.
- Contribute sidebar pages through `navigation`; never hard-code feature routes in `App.tsx`.
- Contribute settings through the feature manifest. Never add feature-specific conditions to `SettingsPage`.
- Use semantic classes such as `bg-primary` and `text-muted-foreground`. Do not hard-code product colors in components or features.
- Keep feature imports one-way: features may depend on `core`, `components/ui`, and their own files. Features must not import another feature's internals.
- Keep source-level installation explicit. Do not add runtime remote-code loading.
- Add focused tests for registry contracts and observable behavior.

## Verification

Run `pnpm check` and `cargo check --manifest-path src-tauri/Cargo.toml` after relevant changes. Run `pnpm tauri build` for release-sensitive changes.
