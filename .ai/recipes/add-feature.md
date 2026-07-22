# Add a source feature

1. Read the root and `src/features/AGENTS.md` rules.
2. Create `src/features/<feature-id>/index.ts` with a `defineFeature(...)` manifest.
3. Keep all feature-specific UI, state, services, and tests inside that directory.
4. Provide both `zh-CN` and `en` for feature names, descriptions, navigation, settings, options, and module-owned page text. Resolve page text through the base i18n state instead of hard-coding one language.
5. Declare feature pages through `navigation`. Do not edit the application shell.
6. Declare simple settings in the manifest. Do not edit the settings page.
7. Register the feature once in `src/app/module-registry.ts`.
8. If native behavior is needed, add a matching module under `src-tauri/src/features` with narrow commands and permissions.
9. Verify that disabling the feature removes its sidebar pages and settings contributions.
10. Run the checks in the root `AGENTS.md`.
