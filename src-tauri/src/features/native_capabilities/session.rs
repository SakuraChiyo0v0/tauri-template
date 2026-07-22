use std::{collections::HashMap, sync::Mutex};

use super::permissions::{NativeCapabilityKind, NormalizedNativeCapabilities};

#[derive(Debug, Clone)]
pub struct NativeSession {
    pub module_id: String,
    pub version: String,
    pub permissions: NormalizedNativeCapabilities,
}

#[derive(Debug, Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, NativeSession>>,
}

impl SessionManager {
    pub fn issue(
        &self,
        module_id: &str,
        version: &str,
        permissions: NormalizedNativeCapabilities,
        selected: bool,
        approved: bool,
    ) -> Result<String, String> {
        if !selected {
            return Err("module version is not selected by the activation plan".into());
        }
        if !approved {
            return Err("module native permissions are not approved".into());
        }
        let mut bytes = [0_u8; 32];
        getrandom::fill(&mut bytes)
            .map_err(|error| format!("generate native session token: {error}"))?;
        let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let session = NativeSession {
            module_id: module_id.to_owned(),
            version: version.to_owned(),
            permissions,
        };
        self.sessions
            .lock()
            .map_err(|_| "native session lock poisoned")?
            .insert(token.clone(), session);
        Ok(token)
    }

    pub fn require(
        &self,
        token: &str,
        capability: NativeCapabilityKind,
    ) -> Result<NativeSession, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "native session lock poisoned")?;
        let session = sessions.get(token).ok_or("invalid_session")?;
        if !session.permissions.has_kind(capability) {
            return Err("permission_denied".into());
        }
        Ok(session.clone())
    }

    pub fn revoke_module(&self, module_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.retain(|_, session| session.module_id != module_id);
        }
    }

    pub fn revoke_token(&self, token: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(token);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::native_capabilities::permissions::{
        NativeCapabilities, ProcessCapability,
    };

    fn approved() -> crate::features::native_capabilities::permissions::NormalizedNativeCapabilities
    {
        NativeCapabilities {
            process: Some(ProcessCapability {
                url_schemes: vec!["https".into()],
                executable_grants: false,
            }),
            ..NativeCapabilities::default()
        }
        .normalize()
        .unwrap()
    }

    #[test]
    fn issues_version_bound_unpredictable_sessions_and_checks_capabilities() {
        let manager = SessionManager::default();
        let permissions = approved();
        let first = manager
            .issue("sample-module", "1.0.0", permissions.clone(), true, true)
            .unwrap();
        let second = manager
            .issue("sample-module", "1.0.0", permissions, true, true)
            .unwrap();
        assert_ne!(first, second);
        assert!(first.len() >= 32);

        let session = manager
            .require(&first, NativeCapabilityKind::Process)
            .unwrap();
        assert_eq!(session.module_id, "sample-module");
        assert_eq!(session.version, "1.0.0");
        assert!(
            manager
                .require(&first, NativeCapabilityKind::Filesystem)
                .is_err()
        );
    }

    #[test]
    fn refuses_unselected_or_unapproved_modules_and_invalidates_old_tokens() {
        let manager = SessionManager::default();
        let permissions = approved();
        assert!(
            manager
                .issue("sample-module", "1.0.0", permissions.clone(), false, true)
                .is_err()
        );
        assert!(
            manager
                .issue("sample-module", "1.0.0", permissions.clone(), true, false)
                .is_err()
        );

        let token = manager
            .issue("sample-module", "1.0.0", permissions, true, true)
            .unwrap();
        manager.revoke_module("sample-module");
        assert!(
            manager
                .require(&token, NativeCapabilityKind::Process)
                .is_err()
        );
        assert!(
            manager
                .require("forged-token", NativeCapabilityKind::Process)
                .is_err()
        );
    }
}
