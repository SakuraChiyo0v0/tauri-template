# Native feature rules

- Keep native feature code under `src/features` and expose the smallest registration surface to `lib.rs`.
- Commands must validate string inputs and return useful `Result` errors.
- Add only the Tauri capabilities required by the feature.
- When documenting removal, include the Rust module, `lib.rs` registration, Cargo dependency, and capability entry.
- Do not expose filesystem, shell, network, or process permissions as generic convenience capabilities.
- Run `cargo fmt --check` and `cargo check` after native changes.
