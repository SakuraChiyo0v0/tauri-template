use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{
    Connection,
    hooks::{AuthAction, AuthContext, Authorization},
    params_from_iter,
    types::{Value as SqliteValue, ValueRef},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::manifest::is_module_id;

pub const MAX_RESULT_ROWS: usize = 1_000;
const MAX_RESULT_BYTES: usize = 4 * 1024 * 1024;
const MAX_SQL_BYTES: usize = 256 * 1024;
const MAX_PARAMETERS: usize = 512;
const MAX_TRANSACTION_STATEMENTS: usize = 256;
const DATABASE_FILE: &str = "data.sqlite3";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

#[cfg(test)]
impl DatabaseStatement {
    pub fn new(sql: impl Into<String>, params: Vec<Value>) -> Self {
        Self {
            sql: sql.into(),
            params,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseExecuteResult {
    pub rows_affected: usize,
    pub last_insert_id: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDataInventoryItem {
    pub module_id: String,
    pub size_bytes: u64,
    pub installed: bool,
}

#[derive(Debug, Clone)]
pub struct ModuleDatabaseManager {
    root: PathBuf,
}

impl ModuleDatabaseManager {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn database_path(&self, module_id: &str) -> Result<PathBuf, String> {
        validate_module_id(module_id)?;
        Ok(self.root.join(module_id).join(DATABASE_FILE))
    }

    pub fn execute(
        &self,
        module_id: &str,
        sql: &str,
        params: &[Value],
    ) -> Result<DatabaseExecuteResult, String> {
        let connection = self.open(module_id, true)?;
        execute_statement(&connection, sql, params)
    }

    pub fn select(
        &self,
        module_id: &str,
        sql: &str,
        params: &[Value],
    ) -> Result<Vec<BTreeMap<String, Value>>, String> {
        let connection = self.open(module_id, true)?;
        select_rows(&connection, sql, params)
    }

    pub fn transaction(
        &self,
        module_id: &str,
        statements: &[DatabaseStatement],
    ) -> Result<Vec<DatabaseExecuteResult>, String> {
        if statements.is_empty() {
            return Err("database transaction must contain at least one statement".into());
        }
        if statements.len() > MAX_TRANSACTION_STATEMENTS {
            return Err(format!(
                "database transaction exceeds statement limit {MAX_TRANSACTION_STATEMENTS}"
            ));
        }
        let mut connection = self.open(module_id, true)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("begin database transaction: {error}"))?;
        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            results.push(execute_statement(
                &transaction,
                &statement.sql,
                &statement.params,
            )?);
        }
        transaction
            .commit()
            .map_err(|error| format!("commit database transaction: {error}"))?;
        Ok(results)
    }

    pub fn get_user_version(&self, module_id: &str) -> Result<u32, String> {
        let connection = self.open(module_id, false)?;
        connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| format!("read database user version: {error}"))
    }

    pub fn set_user_version(&self, module_id: &str, version: u32) -> Result<(), String> {
        let connection = self.open(module_id, false)?;
        connection
            .pragma_update(None, "user_version", version)
            .map_err(|error| format!("set database user version: {error}"))
    }

    pub fn inventory(
        &self,
        installed_module_ids: &HashSet<String>,
    ) -> Result<Vec<ModuleDataInventoryItem>, String> {
        let mut inventory = Vec::new();
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(inventory),
            Err(error) => return Err(format!("read module data directory: {error}")),
        };
        for entry in entries {
            let entry = entry.map_err(|error| format!("read module data entry: {error}"))?;
            if !entry
                .file_type()
                .map_err(|error| format!("inspect module data entry: {error}"))?
                .is_dir()
            {
                continue;
            }
            let module_id = entry.file_name().to_string_lossy().to_string();
            if !is_module_id(&module_id) {
                continue;
            }
            let database_path = entry.path().join(DATABASE_FILE);
            if !database_path.is_file() {
                continue;
            }
            inventory.push(ModuleDataInventoryItem {
                module_id: module_id.clone(),
                size_bytes: database_files_size(&database_path)?,
                installed: installed_module_ids.contains(&module_id),
            });
        }
        inventory.sort_by(|left, right| left.module_id.cmp(&right.module_id));
        Ok(inventory)
    }

    pub fn clear(&self, module_id: &str, active: bool) -> Result<(), String> {
        if active {
            return Err("disable the runtime module before clearing its database".into());
        }
        let database_path = self.database_path(module_id)?;
        for path in database_files(&database_path) {
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("remove module database file: {error}")),
            }
        }
        let directory = database_path
            .parent()
            .ok_or_else(|| "module database path has no parent".to_string())?;
        match fs::remove_dir(directory) {
            Ok(()) => Ok(()),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
                ) =>
            {
                Ok(())
            }
            Err(error) => Err(format!("remove module data directory: {error}")),
        }
    }

    fn open(&self, module_id: &str, restricted: bool) -> Result<Connection, String> {
        let database_path = self.database_path(module_id)?;
        let directory = database_path
            .parent()
            .ok_or_else(|| "module database path has no parent".to_string())?;
        fs::create_dir_all(directory)
            .map_err(|error| format!("create module data directory: {error}"))?;
        let connection = Connection::open(&database_path)
            .map_err(|error| format!("open module database: {error}"))?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|error| format!("enable database foreign keys: {error}"))?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| format!("enable database WAL mode: {error}"))?;
        if restricted {
            connection
                .authorizer(Some(authorize_module_sql))
                .map_err(|error| format!("install database authorizer: {error}"))?;
        }
        Ok(connection)
    }
}

fn validate_module_id(module_id: &str) -> Result<(), String> {
    if !is_module_id(module_id) || matches!(module_id, "system" | "logging") {
        return Err(format!("invalid or reserved module id: {module_id}"));
    }
    Ok(())
}

fn authorize_module_sql(context: AuthContext<'_>) -> Authorization {
    if context
        .database_name
        .is_some_and(|database| !matches!(database, "main" | "temp"))
    {
        return Authorization::Deny;
    }
    match context.action {
        AuthAction::Attach { .. }
        | AuthAction::Detach { .. }
        | AuthAction::Pragma { .. }
        | AuthAction::CreateVtable { .. }
        | AuthAction::DropVtable { .. }
        | AuthAction::Unknown { .. } => Authorization::Deny,
        AuthAction::Function { function_name }
            if function_name.eq_ignore_ascii_case("load_extension") =>
        {
            Authorization::Deny
        }
        _ => Authorization::Allow,
    }
}

fn validate_request(sql: &str, params: &[Value]) -> Result<Vec<SqliteValue>, String> {
    if sql.trim().is_empty() || sql.len() > MAX_SQL_BYTES {
        return Err(format!("database SQL must be 1..={MAX_SQL_BYTES} bytes"));
    }
    if params.len() > MAX_PARAMETERS {
        return Err(format!("database parameters exceed limit {MAX_PARAMETERS}"));
    }
    params.iter().map(json_to_sqlite).collect()
}

fn json_to_sqlite(value: &Value) -> Result<SqliteValue, String> {
    match value {
        Value::Null => Ok(SqliteValue::Null),
        Value::Bool(value) => Ok(SqliteValue::Integer(i64::from(*value))),
        Value::String(value) => Ok(SqliteValue::Text(value.clone())),
        Value::Number(value) if value.as_i64().is_some() => {
            let integer = value.as_i64().unwrap();
            if integer.unsigned_abs() > 9_007_199_254_740_991 {
                return Err("database integer exceeds JavaScript safe range".into());
            }
            Ok(SqliteValue::Integer(integer))
        }
        Value::Number(value) => value
            .as_f64()
            .filter(|number| number.is_finite())
            .map(SqliteValue::Real)
            .ok_or_else(|| "database number must be finite".into()),
        Value::Array(values) => values
            .iter()
            .map(|value| {
                value
                    .as_u64()
                    .filter(|value| *value <= u8::MAX.into())
                    .map(|value| value as u8)
                    .ok_or_else(|| "database blob values must be bytes".to_string())
            })
            .collect::<Result<Vec<_>, _>>()
            .map(SqliteValue::Blob),
        _ => Err("database parameters must be JSON scalar values or byte arrays".into()),
    }
}

fn execute_statement(
    connection: &Connection,
    sql: &str,
    params: &[Value],
) -> Result<DatabaseExecuteResult, String> {
    let values = validate_request(sql, params)?;
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| format!("prepare database statement: {error}"))?;
    if statement.parameter_count() != values.len() {
        return Err(format!(
            "database statement expects {} parameters, received {}",
            statement.parameter_count(),
            values.len()
        ));
    }
    let rows_affected = statement
        .execute(params_from_iter(values.iter()))
        .map_err(|error| format!("execute database statement: {error}"))?;
    let last_insert_id = connection.last_insert_rowid();
    if last_insert_id.unsigned_abs() > 9_007_199_254_740_991 {
        return Err("database last insert id exceeds JavaScript safe range".into());
    }
    Ok(DatabaseExecuteResult {
        rows_affected,
        last_insert_id,
    })
}

fn select_rows(
    connection: &Connection,
    sql: &str,
    params: &[Value],
) -> Result<Vec<BTreeMap<String, Value>>, String> {
    let values = validate_request(sql, params)?;
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| format!("prepare database query: {error}"))?;
    if !statement.readonly() {
        return Err("database select accepts read-only statements only".into());
    }
    if statement.parameter_count() != values.len() {
        return Err(format!(
            "database query expects {} parameters, received {}",
            statement.parameter_count(),
            values.len()
        ));
    }
    let column_names = (0..statement.column_count())
        .map(|index| {
            statement
                .column_name(index)
                .map(str::to_string)
                .map_err(|error| format!("read database column name: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut cursor = statement
        .query(params_from_iter(values.iter()))
        .map_err(|error| format!("query module database: {error}"))?;
    let mut result = Vec::new();
    let mut result_bytes = 0usize;
    while let Some(row) = cursor
        .next()
        .map_err(|error| format!("read module database row: {error}"))?
    {
        if result.len() >= MAX_RESULT_ROWS {
            return Err(format!(
                "database query exceeds row limit {MAX_RESULT_ROWS}"
            ));
        }
        let mut item = BTreeMap::new();
        for (index, name) in column_names.iter().enumerate() {
            let value = sqlite_to_json(
                row.get_ref(index)
                    .map_err(|error| format!("read database value: {error}"))?,
            )?;
            item.insert(name.clone(), value);
        }
        result_bytes += serde_json::to_vec(&item)
            .map_err(|error| format!("serialize database row: {error}"))?
            .len();
        if result_bytes > MAX_RESULT_BYTES {
            return Err(format!(
                "database query exceeds result limit {MAX_RESULT_BYTES} bytes"
            ));
        }
        result.push(item);
    }
    Ok(result)
}

fn sqlite_to_json(value: ValueRef<'_>) -> Result<Value, String> {
    match value {
        ValueRef::Null => Ok(Value::Null),
        ValueRef::Integer(value) => {
            if value.unsigned_abs() > 9_007_199_254_740_991 {
                return Err("database integer exceeds JavaScript safe range".into());
            }
            Ok(Value::from(value))
        }
        ValueRef::Real(value) if value.is_finite() => serde_json::Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| "database number must be finite".into()),
        ValueRef::Real(_) => Err("database number must be finite".into()),
        ValueRef::Text(value) => std::str::from_utf8(value)
            .map(|value| Value::String(value.to_string()))
            .map_err(|error| format!("database text is not UTF-8: {error}")),
        ValueRef::Blob(value) => Ok(Value::Array(
            value.iter().copied().map(Value::from).collect(),
        )),
    }
}

fn database_files(database_path: &Path) -> [PathBuf; 4] {
    let base = database_path.to_string_lossy();
    [
        database_path.to_path_buf(),
        PathBuf::from(format!("{base}-wal")),
        PathBuf::from(format!("{base}-shm")),
        PathBuf::from(format!("{base}-journal")),
    ]
}

fn database_files_size(database_path: &Path) -> Result<u64, String> {
    database_files(database_path)
        .iter()
        .try_fold(0u64, |total, path| match fs::metadata(path) {
            Ok(metadata) if metadata.is_file() => Ok(total + metadata.len()),
            Ok(_) => Ok(total),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(total),
            Err(error) => Err(format!("inspect module database size: {error}")),
        })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use serde_json::json;

    use super::*;

    #[test]
    fn isolates_module_files_and_persists_rows() {
        let temp = tempfile::tempdir().unwrap();
        let manager = ModuleDatabaseManager::new(temp.path().join("data"));
        for module_id in ["alpha-module", "beta-module"] {
            manager
                .execute(
                    module_id,
                    "CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
                    &[],
                )
                .unwrap();
            manager
                .execute(
                    module_id,
                    "INSERT INTO records (value) VALUES (?1)",
                    &[json!(module_id)],
                )
                .unwrap();
        }

        let reopened = ModuleDatabaseManager::new(temp.path().join("data"));
        let alpha = reopened
            .select("alpha-module", "SELECT value FROM records", &[])
            .unwrap();
        let beta = reopened
            .select("beta-module", "SELECT value FROM records", &[])
            .unwrap();
        assert_eq!(alpha[0]["value"], "alpha-module");
        assert_eq!(beta[0]["value"], "beta-module");
        assert_ne!(
            reopened.database_path("alpha-module").unwrap(),
            reopened.database_path("beta-module").unwrap()
        );
    }

    #[test]
    fn supports_parameters_transactions_and_user_version() {
        let temp = tempfile::tempdir().unwrap();
        let manager = ModuleDatabaseManager::new(temp.path().join("data"));
        manager
            .execute(
                "notes-module",
                "CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT UNIQUE NOT NULL, done INTEGER NOT NULL)",
                &[],
            )
            .unwrap();
        let results = manager
            .transaction(
                "notes-module",
                &[
                    DatabaseStatement::new(
                        "INSERT INTO notes (title, done) VALUES (?1, ?2)",
                        vec![json!("one"), json!(true)],
                    ),
                    DatabaseStatement::new(
                        "INSERT INTO notes (title, done) VALUES (?1, ?2)",
                        vec![json!("two"), json!(false)],
                    ),
                ],
            )
            .unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(
            manager
                .select(
                    "notes-module",
                    "SELECT title, done FROM notes ORDER BY id",
                    &[]
                )
                .unwrap()
                .len(),
            2
        );

        let failed = manager.transaction(
            "notes-module",
            &[
                DatabaseStatement::new(
                    "INSERT INTO notes (title, done) VALUES (?1, 0)",
                    vec![json!("three")],
                ),
                DatabaseStatement::new(
                    "INSERT INTO notes (title, done) VALUES (?1, 0)",
                    vec![json!("one")],
                ),
            ],
        );
        assert!(failed.is_err());
        assert_eq!(
            manager
                .select("notes-module", "SELECT title FROM notes", &[])
                .unwrap()
                .len(),
            2
        );

        assert_eq!(manager.get_user_version("notes-module").unwrap(), 0);
        manager.set_user_version("notes-module", 3).unwrap();
        assert_eq!(manager.get_user_version("notes-module").unwrap(), 3);
    }

    #[test]
    fn rejects_unsafe_sql_ids_and_unbounded_results() {
        let temp = tempfile::tempdir().unwrap();
        let manager = ModuleDatabaseManager::new(temp.path().join("data"));
        assert!(
            manager
                .execute("../escape", "CREATE TABLE x (id INTEGER)", &[])
                .is_err()
        );
        for sql in [
            "ATTACH DATABASE 'outside.sqlite3' AS outside",
            "DETACH DATABASE main",
            "PRAGMA journal_mode = DELETE",
            "CREATE TABLE one (id INTEGER); CREATE TABLE two (id INTEGER)",
        ] {
            assert!(
                manager.execute("safe-module", sql, &[]).is_err(),
                "accepted {sql}"
            );
        }
        manager
            .execute("safe-module", "CREATE TABLE rows (value INTEGER)", &[])
            .unwrap();
        assert!(
            manager
                .select("safe-module", "DELETE FROM rows", &[])
                .is_err()
        );
        let oversized = format!(
            "SELECT value FROM (WITH RECURSIVE counter(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < {}) SELECT value FROM counter)",
            MAX_RESULT_ROWS + 1
        );
        assert!(manager.select("safe-module", &oversized, &[]).is_err());
        assert!(
            manager
                .transaction(
                    "safe-module",
                    &vec![
                        DatabaseStatement::new("INSERT INTO rows (value) VALUES (1)", vec![]);
                        MAX_TRANSACTION_STATEMENTS + 1
                    ]
                )
                .is_err()
        );
    }

    #[test]
    fn inventories_and_clears_only_inactive_module_data() {
        let temp = tempfile::tempdir().unwrap();
        let manager = ModuleDatabaseManager::new(temp.path().join("data"));
        manager
            .execute("kept-module", "CREATE TABLE records (value TEXT)", &[])
            .unwrap();
        manager
            .execute("orphan-module", "CREATE TABLE records (value TEXT)", &[])
            .unwrap();
        let private_file = temp
            .path()
            .join("data/orphan-module/files/verification/activation.txt");
        fs::create_dir_all(private_file.parent().unwrap()).unwrap();
        fs::write(&private_file, b"Host SDK V3").unwrap();

        let installed = HashSet::from(["kept-module".to_string()]);
        let inventory = manager.inventory(&installed).unwrap();
        assert_eq!(inventory.len(), 2);
        assert!(
            inventory
                .iter()
                .find(|item| item.module_id == "kept-module")
                .unwrap()
                .installed
        );
        assert!(
            !inventory
                .iter()
                .find(|item| item.module_id == "orphan-module")
                .unwrap()
                .installed
        );
        assert!(manager.clear("kept-module", true).is_err());
        manager.clear("orphan-module", false).unwrap();
        assert!(!manager.database_path("orphan-module").unwrap().exists());
        assert_eq!(fs::read(private_file).unwrap(), b"Host SDK V3");
        assert!(manager.database_path("kept-module").unwrap().exists());
    }

    #[test]
    #[ignore = "manual smoke: set MTP_DATABASE_SMOKE to a real Host SDK V2 package"]
    fn runs_real_v2_package_database_lifecycle_smoke() {
        let package = std::env::var("MTP_DATABASE_SMOKE").expect("MTP_DATABASE_SMOKE is required");
        let temp = tempfile::tempdir().unwrap();
        let store = super::super::store::ModuleStore::new(
            temp.path().join("modules"),
            semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap(),
        );
        let installed = store.install(std::path::Path::new(&package)).unwrap();
        assert_eq!(installed.manifest.sdk_version, 2);
        let module_id = installed.manifest.id;
        let manager = ModuleDatabaseManager::new(temp.path().join("runtime-module-data"));
        manager
            .execute(
                &module_id,
                "CREATE TABLE module_events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL)",
                &[],
            )
            .unwrap();
        manager
            .execute(
                &module_id,
                "INSERT INTO module_events (kind) VALUES (?1)",
                &[json!("activation")],
            )
            .unwrap();
        let reopened = ModuleDatabaseManager::new(temp.path().join("runtime-module-data"));
        assert_eq!(
            reopened
                .select(&module_id, "SELECT kind FROM module_events", &[])
                .unwrap()[0]["kind"],
            "activation"
        );

        store.set_enabled(&module_id, false).unwrap();
        store.uninstall(&module_id).unwrap();
        let inventory = reopened.inventory(&HashSet::new()).unwrap();
        assert_eq!(inventory[0].module_id, module_id);
        assert!(!inventory[0].installed);
        reopened.clear(&module_id, false).unwrap();
        assert!(reopened.inventory(&HashSet::new()).unwrap().is_empty());
    }
}
