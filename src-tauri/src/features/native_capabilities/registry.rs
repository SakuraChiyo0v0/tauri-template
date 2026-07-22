use serde::{Deserialize, Serialize};

use super::permissions::{RegistryAccess, RegistryHive, RegistryScope, normalize_registry_key};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegistryOperation {
    Read,
    Write,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "value", rename_all = "kebab-case")]
pub enum RegistryValue {
    String(String),
    Dword(u32),
    Qword(u64),
    Binary(Vec<u8>),
    MultiString(Vec<String>),
}

#[derive(Debug, Clone)]
pub struct RegistryProxy {
    scopes: Vec<RegistryScope>,
}

impl RegistryProxy {
    pub fn new(scopes: Vec<RegistryScope>) -> Self {
        Self { scopes }
    }

    pub fn authorize(
        &self,
        hive: RegistryHive,
        key: &str,
        operation: RegistryOperation,
    ) -> Result<String, String> {
        let normalized = normalize_registry_key(key)?;
        let normalized_lower = normalized.to_ascii_lowercase();
        let approved = self.scopes.iter().any(|scope| {
            let scope_lower = scope.key.to_ascii_lowercase();
            scope.hive == hive
                && (operation == RegistryOperation::Read
                    || scope.access == RegistryAccess::ReadWrite)
                && (normalized_lower == scope_lower
                    || normalized_lower.starts_with(&format!("{scope_lower}\\")))
        });
        if !approved {
            return Err("registry_scope_denied".into());
        }
        if hive == RegistryHive::LocalMachine && operation == RegistryOperation::Write {
            return Err("HKLM_write_denied".into());
        }
        Ok(normalized)
    }

    #[cfg(windows)]
    pub fn read(
        &self,
        hive: RegistryHive,
        key: &str,
        value_name: &str,
    ) -> Result<RegistryValue, String> {
        use winreg::{enums::*, types::FromRegValue};
        validate_value_name(value_name)?;
        let key = self.authorize(hive, key, RegistryOperation::Read)?;
        let root = predefined_key(hive);
        let key = root
            .open_subkey_with_flags(key, KEY_READ)
            .map_err(|error| format!("open registry key: {error}"))?;
        let raw = key
            .get_raw_value(value_name)
            .map_err(|error| format!("read registry value: {error}"))?;
        match raw.vtype {
            REG_SZ | REG_EXPAND_SZ => String::from_reg_value(&raw).map(RegistryValue::String),
            REG_DWORD | REG_DWORD_BIG_ENDIAN => u32::from_reg_value(&raw).map(RegistryValue::Dword),
            REG_QWORD => u64::from_reg_value(&raw).map(RegistryValue::Qword),
            REG_BINARY => Ok(RegistryValue::Binary(raw.bytes)),
            REG_MULTI_SZ => Vec::<String>::from_reg_value(&raw).map(RegistryValue::MultiString),
            _ => Err(std::io::Error::other("unsupported registry value type")),
        }
        .map_err(|error| format!("decode registry value: {error}"))
    }

    #[cfg(not(windows))]
    pub fn read(
        &self,
        _hive: RegistryHive,
        _key: &str,
        _value_name: &str,
    ) -> Result<RegistryValue, String> {
        Err("unsupported_platform".into())
    }

    #[cfg(windows)]
    pub fn write(
        &self,
        hive: RegistryHive,
        key: &str,
        value_name: &str,
        value: RegistryValue,
    ) -> Result<(), String> {
        use winreg::{RegValue, enums::*, types::ToRegValue};
        validate_value_name(value_name)?;
        let key = self.authorize(hive, key, RegistryOperation::Write)?;
        let root = predefined_key(hive);
        let (key, _) = root
            .create_subkey_with_flags(key, KEY_READ | KEY_WRITE)
            .map_err(|error| format!("create registry key: {error}"))?;
        let raw = match value {
            RegistryValue::String(value) => value.to_reg_value(),
            RegistryValue::Dword(value) => value.to_reg_value(),
            RegistryValue::Qword(value) => value.to_reg_value(),
            RegistryValue::Binary(bytes) => RegValue {
                bytes,
                vtype: REG_BINARY,
            },
            RegistryValue::MultiString(values) => values.to_reg_value(),
        };
        key.set_raw_value(value_name, &raw)
            .map_err(|error| format!("write registry value: {error}"))
    }

    #[cfg(not(windows))]
    pub fn write(
        &self,
        _hive: RegistryHive,
        _key: &str,
        _value_name: &str,
        _value: RegistryValue,
    ) -> Result<(), String> {
        Err("unsupported_platform".into())
    }

    #[cfg(windows)]
    pub fn delete_value(
        &self,
        hive: RegistryHive,
        key: &str,
        value_name: &str,
    ) -> Result<(), String> {
        use winreg::enums::{KEY_READ, KEY_WRITE};
        validate_value_name(value_name)?;
        let key = self.authorize(hive, key, RegistryOperation::Write)?;
        let root = predefined_key(hive);
        let key = root
            .open_subkey_with_flags(key, KEY_READ | KEY_WRITE)
            .map_err(|error| format!("open registry key: {error}"))?;
        key.delete_value(value_name)
            .map_err(|error| format!("delete registry value: {error}"))
    }

    #[cfg(not(windows))]
    pub fn delete_value(
        &self,
        _hive: RegistryHive,
        _key: &str,
        _value_name: &str,
    ) -> Result<(), String> {
        Err("unsupported_platform".into())
    }
}

fn validate_value_name(value: &str) -> Result<(), String> {
    if value.len() > 255 || value.contains(['\\', '/']) || value.chars().any(char::is_control) {
        return Err("invalid_registry_value_name".into());
    }
    Ok(())
}

#[cfg(windows)]
fn predefined_key(hive: RegistryHive) -> winreg::RegKey {
    use winreg::{
        RegKey,
        enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
    };
    match hive {
        RegistryHive::CurrentUser => RegKey::predef(HKEY_CURRENT_USER),
        RegistryHive::LocalMachine => RegKey::predef(HKEY_LOCAL_MACHINE),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::native_capabilities::permissions::{
        RegistryAccess, RegistryHive, RegistryScope,
    };

    fn scopes(key: String) -> Vec<RegistryScope> {
        vec![
            RegistryScope {
                hive: RegistryHive::CurrentUser,
                key,
                access: RegistryAccess::ReadWrite,
            },
            RegistryScope {
                hive: RegistryHive::LocalMachine,
                key: "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion".into(),
                access: RegistryAccess::Read,
            },
        ]
    }

    #[test]
    fn enforces_hive_prefix_and_access_without_parent_escape() {
        let proxy = RegistryProxy::new(scopes("Software\\Example\\Allowed".into()));
        assert!(
            proxy
                .authorize(
                    RegistryHive::CurrentUser,
                    "Software\\Example\\Allowed\\Child",
                    RegistryOperation::Write
                )
                .is_ok()
        );
        assert!(
            proxy
                .authorize(
                    RegistryHive::CurrentUser,
                    "software/example/allowed/Child",
                    RegistryOperation::Read
                )
                .is_ok()
        );
        assert!(
            proxy
                .authorize(
                    RegistryHive::CurrentUser,
                    "Software\\Example\\Sibling",
                    RegistryOperation::Read
                )
                .is_err()
        );
        assert!(
            proxy
                .authorize(
                    RegistryHive::CurrentUser,
                    "Software\\Example\\Allowed\\..\\Sibling",
                    RegistryOperation::Read
                )
                .is_err()
        );
        assert!(
            proxy
                .authorize(
                    RegistryHive::LocalMachine,
                    "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
                    RegistryOperation::Write
                )
                .is_err()
        );
    }

    #[cfg(windows)]
    #[test]
    fn round_trips_supported_hkcu_value_types_and_deletes_only_a_value() {
        use std::time::{SystemTime, UNIX_EPOCH};
        use winreg::{RegKey, enums::HKEY_CURRENT_USER};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let key = format!("Software\\ModularTauriTemplate\\Tests\\native-{suffix}");
        let proxy = RegistryProxy::new(scopes(key.clone()));
        let values = [
            ("text", RegistryValue::String("hello".into())),
            ("dword", RegistryValue::Dword(42)),
            ("qword", RegistryValue::Qword(9_007_199_254_740_991)),
            ("binary", RegistryValue::Binary(vec![0, 1, 2, 255])),
            (
                "multi",
                RegistryValue::MultiString(vec!["one".into(), "two".into()]),
            ),
        ];
        for (name, value) in &values {
            proxy
                .write(RegistryHive::CurrentUser, &key, name, value.clone())
                .unwrap();
            assert_eq!(
                proxy.read(RegistryHive::CurrentUser, &key, name).unwrap(),
                *value
            );
        }
        proxy
            .delete_value(RegistryHive::CurrentUser, &key, "text")
            .unwrap();
        assert!(proxy.read(RegistryHive::CurrentUser, &key, "text").is_err());
        assert_eq!(
            proxy
                .read(RegistryHive::CurrentUser, &key, "dword")
                .unwrap(),
            RegistryValue::Dword(42)
        );

        RegKey::predef(HKEY_CURRENT_USER)
            .delete_subkey_all(&key)
            .unwrap();
    }
}
