# Add a source feature

1. Read the root and `src/features/AGENTS.md` rules.
2. Create `src/features/<feature-id>/index.ts` with a `defineFeature(...)` manifest.
3. Keep all feature-specific UI, state, services, and tests inside that directory.
4. Declare feature pages through `navigation`. Do not edit the application shell.
5. Declare simple settings in the manifest. Do not edit the settings page.
6. Register the feature once in `src/app/module-registry.ts`.
7. If native behavior is needed, add a matching module under `src-tauri/src/features` with narrow commands and permissions.
8. Verify that disabling the feature removes its sidebar pages and settings contributions.
9. Run the checks in the root `AGENTS.md`.
