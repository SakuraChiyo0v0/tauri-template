# UI primitive rules

- Components here must remain reusable and must not know about feature modules.
- Use the semantic tokens declared in `src/styles/globals.css`; never bind a component to a preset theme.
- Preserve keyboard behavior, labels, focus visibility, disabled states, and Radix accessibility behavior.
- Prefer extending variants over copying a primitive into a feature.
- Add a dependency only when the primitive genuinely needs it.
