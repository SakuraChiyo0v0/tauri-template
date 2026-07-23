use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

const MAX_TITLE_LEN: usize = 200;
const MAX_BODY_LEN: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleNotification {
    pub title: String,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSendResult {
    pub module_id: String,
    pub sent: bool,
}

pub fn send_notification(
    app: &AppHandle,
    module_id: &str,
    notification: ModuleNotification,
) -> Result<NotificationSendResult, String> {
    validate_notification(&notification)?;
    let title = truncate(notification.title.trim(), MAX_TITLE_LEN);
    let body = truncate(
        notification.body.as_deref().map(str::trim).unwrap_or(""),
        MAX_BODY_LEN,
    );
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| format!("send system notification: {error}"))?;
    Ok(NotificationSendResult {
        module_id: module_id.to_string(),
        sent: true,
    })
}

fn validate_notification(notification: &ModuleNotification) -> Result<(), String> {
    let title = notification.title.trim();
    if title.is_empty() {
        return Err("notification title must be a non-empty string".into());
    }
    if title.chars().any(char::is_control) {
        return Err("notification title must not contain control characters".into());
    }
    if let Some(body) = &notification.body
        && body.chars().any(char::is_control)
    {
        return Err("notification body must not contain control characters".into());
    }
    Ok(())
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

    fn notification(title: &str, body: Option<&str>) -> ModuleNotification {
        ModuleNotification {
            title: title.into(),
            body: body.map(Into::into),
        }
    }

    #[test]
    fn validates_title_and_body_boundaries() {
        assert!(validate_notification(&notification("完成", Some("同步结束"))).is_ok());
        assert!(validate_notification(&notification("", None)).is_err());
        assert!(validate_notification(&notification("控制", Some("bad\u{0007}char"))).is_err());
        let long_title = "a".repeat(MAX_TITLE_LEN + 10);
        assert_eq!(truncate(&long_title, MAX_TITLE_LEN).chars().count(), MAX_TITLE_LEN);
    }

    #[test]
    fn notification_send_result_serializes_module_context() {
        let result = NotificationSendResult { module_id: "sample-module".into(), sent: true };
        let serialized = serde_json::to_value(&result).unwrap();
        assert_eq!(serialized["moduleId"], "sample-module");
        assert_eq!(serialized["sent"], true);
    }
}
