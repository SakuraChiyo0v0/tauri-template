# Remove a source feature

1. Identify the feature's frontend and optional native directories.
2. Remove its entry from `src/app/module-registry.ts`.
3. Remove its frontend feature directory.
4. If present, remove its Rust module registration, plugin or Cargo dependency, and capability permission.
5. Search for the feature ID and confirm no imports remain outside documentation or migration notes.
6. Run the checks in the root `AGENTS.md`.

Persisted namespaced settings may remain inert on existing installations. Do not add a global destructive cleanup for them.
