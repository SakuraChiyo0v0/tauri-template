use std::{
    collections::BTreeMap,
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use url::Url;

use super::filesystem::FilesystemManager;

const MAX_ARGUMENTS: usize = 64;
const MAX_ARGUMENT_BYTES: usize = 4_096;
const MAX_PROCESS_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_PROCESS_DURATION: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessResult {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

pub fn validate_url(value: &str, allowed_schemes: &[String]) -> Result<Url, String> {
    let parsed = Url::parse(value).map_err(|error| format!("invalid URL: {error}"))?;
    if !allowed_schemes
        .iter()
        .any(|scheme| scheme.eq_ignore_ascii_case(parsed.scheme()))
    {
        return Err(format!("URL scheme is not approved: {}", parsed.scheme()));
    }
    if matches!(parsed.scheme(), "file" | "javascript" | "data") {
        return Err("unsafe URL scheme".into());
    }
    Ok(parsed)
}

pub trait UrlOpener {
    fn open_url(&self, url: &Url) -> Result<(), String>;
}

pub struct SystemUrlOpener;

impl UrlOpener for SystemUrlOpener {
    fn open_url(&self, url: &Url) -> Result<(), String> {
        tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
            .map_err(|error| format!("open approved URL: {error}"))
    }
}

pub fn open_approved_url(
    opener: &impl UrlOpener,
    value: &str,
    allowed_schemes: &[String],
) -> Result<(), String> {
    let url = validate_url(value, allowed_schemes)?;
    opener.open_url(&url)
}

pub struct ProcessRunner<'a> {
    grants: &'a FilesystemManager,
}

impl<'a> ProcessRunner<'a> {
    pub fn new(grants: &'a FilesystemManager) -> Self {
        Self { grants }
    }

    pub fn run(
        &self,
        module_id: &str,
        grant_id: &str,
        arguments: &[String],
        timeout: Duration,
    ) -> Result<ProcessResult, String> {
        self.run_with_cancellation(
            module_id,
            grant_id,
            arguments,
            timeout,
            Arc::new(AtomicBool::new(false)),
        )
    }

    fn run_with_cancellation(
        &self,
        module_id: &str,
        grant_id: &str,
        arguments: &[String],
        timeout: Duration,
        cancelled: Arc<AtomicBool>,
    ) -> Result<ProcessResult, String> {
        if arguments.len() > MAX_ARGUMENTS
            || arguments.iter().any(|argument| {
                argument.len() > MAX_ARGUMENT_BYTES
                    || argument.chars().any(|character| character == '\0')
            })
        {
            return Err("process_argument_limit".into());
        }
        if timeout.is_zero() || timeout > MAX_PROCESS_DURATION {
            return Err("process_timeout_limit".into());
        }
        let executable = self.grants.resolve_executable(module_id, grant_id)?;
        reject_known_shell(&executable)?;

        let mut command = Command::new(&executable);
        command
            .args(arguments)
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        if let Some(system_root) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", system_root);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("start granted process: {error}"))?;
        let stdout = child.stdout.take().ok_or("process stdout unavailable")?;
        let stderr = child.stderr.take().ok_or("process stderr unavailable")?;
        let exceeded = Arc::new(AtomicBool::new(false));
        let stdout_thread = read_output(stdout, exceeded.clone());
        let stderr_thread = read_output(stderr, exceeded.clone());
        let started = Instant::now();
        let (status, timed_out, failure) = loop {
            if exceeded.load(Ordering::Relaxed) {
                let _ = child.kill();
                let status = child
                    .wait()
                    .map_err(|error| format!("wait for output-limited process: {error}"))?;
                break (status, false, Some("process_output_limit"));
            }
            if cancelled.load(Ordering::Relaxed) {
                let _ = child.kill();
                let status = child
                    .wait()
                    .map_err(|error| format!("wait for cancelled process: {error}"))?;
                break (status, false, Some("process_cancelled"));
            }
            if let Some(status) = child
                .try_wait()
                .map_err(|error| format!("wait for granted process: {error}"))?
            {
                break (status, false, None);
            }
            if started.elapsed() >= timeout {
                child
                    .kill()
                    .map_err(|error| format!("terminate timed out process: {error}"))?;
                let status = child
                    .wait()
                    .map_err(|error| format!("wait for timed out process: {error}"))?;
                break (status, true, None);
            }
            thread::sleep(Duration::from_millis(10));
        };

        let stdout = stdout_thread
            .join()
            .map_err(|_| "stdout reader panicked")?
            .0;
        let stderr = stderr_thread
            .join()
            .map_err(|_| "stderr reader panicked")?
            .0;
        if let Some(failure) = failure {
            return Err(failure.into());
        }
        Ok(ProcessResult {
            code: status.code(),
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            timed_out,
        })
    }
}

pub struct ProcessSupervisor<'a> {
    runner: ProcessRunner<'a>,
    active: Mutex<BTreeMap<String, Vec<Arc<AtomicBool>>>>,
}

impl<'a> ProcessSupervisor<'a> {
    pub fn new(grants: &'a FilesystemManager) -> Self {
        Self {
            runner: ProcessRunner::new(grants),
            active: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn run(
        &self,
        session_token: &str,
        module_id: &str,
        grant_id: &str,
        arguments: &[String],
        timeout: Duration,
    ) -> Result<ProcessResult, String> {
        if session_token.is_empty() {
            return Err("process session token must not be empty".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        self.active
            .lock()
            .map_err(|_| "process supervisor lock poisoned")?
            .entry(session_token.to_owned())
            .or_default()
            .push(cancelled.clone());

        let result = self.runner.run_with_cancellation(
            module_id,
            grant_id,
            arguments,
            timeout,
            cancelled.clone(),
        );
        if let Ok(mut active) = self.active.lock() {
            if let Some(processes) = active.get_mut(session_token) {
                processes.retain(|process| !Arc::ptr_eq(process, &cancelled));
                if processes.is_empty() {
                    active.remove(session_token);
                }
            }
        }
        result
    }

    pub fn cancel_session(&self, session_token: &str) {
        if let Ok(active) = self.active.lock() {
            if let Some(processes) = active.get(session_token) {
                for process in processes {
                    process.store(true, Ordering::Relaxed);
                }
            }
        }
    }
}

fn read_output(
    mut stream: impl Read + Send + 'static,
    exceeded: Arc<AtomicBool>,
) -> thread::JoinHandle<(Vec<u8>, bool)> {
    thread::spawn(move || {
        let mut collected = Vec::new();
        let mut buffer = [0_u8; 8_192];
        let mut overflow = false;
        loop {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    let remaining = MAX_PROCESS_OUTPUT_BYTES.saturating_sub(collected.len());
                    collected.extend_from_slice(&buffer[..count.min(remaining)]);
                    if count > remaining {
                        overflow = true;
                        exceeded.store(true, Ordering::Relaxed);
                    }
                }
            }
        }
        (collected, overflow)
    })
}

fn reject_known_shell(path: &Path) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        name.as_str(),
        "cmd.exe" | "powershell.exe" | "pwsh.exe" | "wsl.exe" | "sh" | "bash" | "zsh" | "fish"
    ) {
        return Err("shell executables are not allowed".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, sync::Mutex, time::Duration};

    use crate::features::native_capabilities::filesystem::{
        FilesystemManager, GrantAccess, GrantKind,
    };

    use super::*;

    #[test]
    fn validates_declared_url_schemes_and_rejects_command_like_values() {
        assert!(validate_url("https://example.com", &["https".into()]).is_ok());
        assert!(validate_url("steam://run/123", &["steam".into()]).is_ok());
        assert!(validate_url("file:///C:/secret.txt", &["https".into()]).is_err());
        assert!(validate_url("powershell -Command whoami", &["https".into()]).is_err());
    }

    #[test]
    fn controlled_opener_invokes_the_platform_only_after_scheme_validation() {
        #[derive(Default)]
        struct RecordingOpener(Mutex<Vec<String>>);

        impl UrlOpener for RecordingOpener {
            fn open_url(&self, url: &Url) -> Result<(), String> {
                self.0.lock().unwrap().push(url.as_str().to_owned());
                Ok(())
            }
        }

        let opener = RecordingOpener::default();
        open_approved_url(&opener, "https://example.com", &["https".into()]).unwrap();
        assert!(open_approved_url(&opener, "steam://run/123", &["https".into()]).is_err());
        assert_eq!(
            opener.0.lock().unwrap().as_slice(),
            ["https://example.com/"]
        );
    }

    #[test]
    fn rejects_ungranted_executables_and_known_shells() {
        let temp = tempfile::tempdir().unwrap();
        let grants =
            FilesystemManager::new(temp.path().join("private"), temp.path().join("grants.json"));
        let runner = ProcessRunner::new(&grants);
        assert!(
            runner
                .run("alpha-module", "missing", &[], Duration::from_secs(1))
                .is_err()
        );

        let shell = PathBuf::from(
            std::env::var("COMSPEC").unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".into()),
        );
        if shell.exists() {
            let grant = grants
                .create_grant(
                    "alpha-module",
                    &shell,
                    GrantKind::Executable,
                    GrantAccess::execute(),
                )
                .unwrap();
            assert!(
                runner
                    .run(
                        "alpha-module",
                        &grant.id,
                        &["/C".into(), "echo unsafe".into()],
                        Duration::from_secs(1)
                    )
                    .is_err()
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn directly_runs_a_granted_program_with_bounded_output() {
        let temp = tempfile::tempdir().unwrap();
        let grants =
            FilesystemManager::new(temp.path().join("private"), temp.path().join("grants.json"));
        let executable = PathBuf::from("C:\\Windows\\System32\\whoami.exe");
        assert!(executable.exists());
        let grant = grants
            .create_grant(
                "alpha-module",
                &executable,
                GrantKind::Executable,
                GrantAccess::execute(),
            )
            .unwrap();
        let result = ProcessRunner::new(&grants)
            .run("alpha-module", &grant.id, &[], Duration::from_secs(5))
            .unwrap();
        assert_eq!(result.code, Some(0));
        assert!(!result.stdout.trim().is_empty());
        assert!(!result.timed_out);
    }

    #[cfg(windows)]
    #[test]
    fn kills_a_granted_program_after_timeout() {
        let temp = tempfile::tempdir().unwrap();
        let grants =
            FilesystemManager::new(temp.path().join("private"), temp.path().join("grants.json"));
        let executable = PathBuf::from("C:\\Windows\\System32\\ping.exe");
        fs::metadata(&executable).unwrap();
        let grant = grants
            .create_grant(
                "alpha-module",
                &executable,
                GrantKind::Executable,
                GrantAccess::execute(),
            )
            .unwrap();
        let result = ProcessRunner::new(&grants)
            .run(
                "alpha-module",
                &grant.id,
                &["127.0.0.1".into(), "-n".into(), "5".into()],
                Duration::from_millis(50),
            )
            .unwrap();
        assert!(result.timed_out);
    }

    #[cfg(windows)]
    #[test]
    fn cancels_running_processes_when_the_session_is_revoked() {
        let temp = tempfile::tempdir().unwrap();
        let grants =
            FilesystemManager::new(temp.path().join("private"), temp.path().join("grants.json"));
        let executable = PathBuf::from("C:\\Windows\\System32\\ping.exe");
        let grant = grants
            .create_grant(
                "alpha-module",
                &executable,
                GrantKind::Executable,
                GrantAccess::execute(),
            )
            .unwrap();
        let supervisor = ProcessSupervisor::new(&grants);

        thread::scope(|scope| {
            let process = scope.spawn(|| {
                supervisor.run(
                    "alpha-token",
                    "alpha-module",
                    &grant.id,
                    &["127.0.0.1".into(), "-n".into(), "10".into()],
                    Duration::from_secs(10),
                )
            });
            thread::sleep(Duration::from_millis(50));
            supervisor.cancel_session("alpha-token");
            assert_eq!(process.join().unwrap().unwrap_err(), "process_cancelled");
        });
    }
}
