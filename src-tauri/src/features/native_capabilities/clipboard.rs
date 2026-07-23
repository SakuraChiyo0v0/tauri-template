use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

const MAX_TEXT_LEN: usize = 1024 * 1024;

pub fn write_text(_app: &AppHandle, text: &str) -> Result<(), String> {
    let trimmed = truncate(text, MAX_TEXT_LEN);
    _app.clipboard()
        .write_text(trimmed)
        .map_err(|error| format!("write clipboard: {error}"))
}

pub fn read_text(app: &AppHandle) -> Result<String, String> {
    app.clipboard()
        .read_text()
        .map_err(|error| format!("read clipboard: {error}"))
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        value.to_string()
    } else {
        value.chars().take(max).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_long_text() {
        let long = "a".repeat(MAX_TEXT_LEN + 5);
        assert_eq!(truncate(&long, MAX_TEXT_LEN).chars().count(), MAX_TEXT_LEN);
        assert_eq!(truncate("short", MAX_TEXT_LEN), "short");
    }
}
