# Modular Tauri Template rules

Read this file before changing the project. Keep the template free of demo business features.

## Architecture

- `src/components/ui` contains reusable, business-neutral UI primitives.
- `src/themes` owns semantic design tokens and theme selection.
- `src/core/i18n` owns the supported locale union, persistence, base messages, and localized-text resolution.
- `src/core` owns stable extension contracts and persistence helpers.
- `src/features/<feature>` owns one removable feature and its settings contributions.
- `src/app/module-registry.ts` is the only source-module installation list.
- `src/core/runtime-modules` owns the stable `.mtp` package, loader, lifecycle, and Host SDK boundary.
- The application shell renders navigation contributed by enabled modules; it never imports feature pages directly.
- `src-tauri/src/features` mirrors features that need native Rust behavior.

## Change rules

- Add business capabilities as feature modules; do not place them in `App.tsx`, settings pages, or UI primitives.
- Every source or runtime module contribution rendered by the host must provide non-empty `zh-CN` and `en` text. Module-owned pages must follow the base locale without reactivation.
- A feature must export one `defineFeature(...)` manifest from its `index.ts`.
- Contribute sidebar pages through `navigation`; never hard-code feature routes in `App.tsx`.
- Contribute settings through the feature manifest. Never add feature-specific conditions to `SettingsPage`.
- Use semantic classes such as `bg-primary` and `text-muted-foreground`. Do not hard-code product colors in components or features.
- Keep feature imports one-way: features may depend on `core`, `components/ui`, and their own files. Features must not import another feature's internals.
- Keep source-level installation explicit. Runtime modules must be user-selected local `.mtp` packages; do not add remote downloads, a plugin store, dynamic Rust, or extra native permissions without a new specification.
- Runtime modules contribute navigation and basic settings only through `manifest.json`; never add module-specific branches to the shell or settings page.
- SDK V4 providers must declare service IDs in `services.provides`. Consumers may call only declared module dependencies, and service payloads must stay within the JSON-compatible Host SDK value type.
- SDK V5/V6 repository modules must declare `nativeCapabilities.moduleRepository.install` and external read/list access. They may receive only opaque grants, top-level `.mtp` file names and short-lived plan IDs; dependency solving, package validation, permission waiting and transaction recovery remain host-owned.
- Treat the Host SDK as a public ABI. Do not expose internal stores, the feature registry, raw Tauri invoke, or arbitrary filesystem access.
- Add focused tests for registry contracts and observable behavior.

## Verification

Run `pnpm check` and `cargo check --manifest-path src-tauri/Cargo.toml` after relevant changes. Run `pnpm tauri build` for release-sensitive changes.
