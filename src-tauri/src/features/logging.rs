use log::LevelFilter;
use tauri::{Runtime, plugin::TauriPlugin};
use tauri_plugin_log::{Target, TargetKind};

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .level(LevelFilter::Trace)
        .max_file_size(5_000_000)
        .target(Target::new(TargetKind::Webview))
        .build()
}

#[tauri::command]
pub fn set_log_level(level: &str) -> Result<(), String> {
    let filter = match level {
        "trace" => LevelFilter::Trace,
        "debug" => LevelFilter::Debug,
        "info" => LevelFilter::Info,
        "warn" => LevelFilter::Warn,
        "error" => LevelFilter::Error,
        _ => return Err(format!("unsupported log level: {level}")),
    };

    log::set_max_level(filter);
    log::info!("log level changed to {level}");
    Ok(())
}
