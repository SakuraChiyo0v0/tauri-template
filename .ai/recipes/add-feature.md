# Add a source feature

1. Read the root and `src/features/AGENTS.md` rules.
2. Create `src/features/<feature-id>/index.ts` with a `defineFeature(...)` manifest.
3. Keep all feature-specific UI, state, services, and tests inside that directory.
4. Declare simple settings in the manifest. Do not edit the settings page.
5. Register the feature once in `src/app/module-registry.ts`.
6. If native behavior is needed, add a matching module under `src-tauri/src/features` with narrow commands and permissions.
7. Verify that disabling the feature removes its frontend contributions.
8. Run the checks in the root `AGENTS.md`.
