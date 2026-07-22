# Runtime module boundary

- This directory is example source only. Never copy it into the base app or preinstall its package.
- Keep `index.js` a self-contained browser ESM file with no imports from the base repository.
- Manifest navigation and settings are the only shared-shell contributions.
- Custom element names must start with the manifest module ID.
- Use semantic CSS variables inherited from the host; do not assume a fixed light or dark theme.
- Use only the documented Host SDK. A need for native permissions is a base-app specification change, not something to bypass here.
- Increment `manifest.json` version before building an update.
