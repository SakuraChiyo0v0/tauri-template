# Add a sidebar page

1. Read the root and `src/features/AGENTS.md` rules.
2. Keep the page component inside its owning feature directory.
3. Add a `navigation` entry to that feature's manifest with a globally unique `id`, `title`, optional `description`, Lucide `icon`, `component`, `group`, and `order`.
4. Use `group: "main"` for primary functionality and `group: "system"` for persistent utility pages near the bottom.
5. Do not import the page into `App.tsx` or add a feature-specific sidebar condition.
6. Verify selection, active styling, title rendering, sidebar collapse, and fallback after the feature is disabled.
