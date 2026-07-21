# Theme rules

- Theme presets only define semantic variables; they do not override individual component selectors.
- Every preset must provide matching light and dark values for all tokens already present in `globals.css`.
- Register preset metadata in `theme-registry.ts` and extend `ThemePresetId` in `theme-types.ts`.
- Keep display mode (`system`, `light`, `dark`) independent from color preset selection.
- Verify at least Button, Select, Dialog, Switch, border, focus ring, and muted text when adding a preset.
