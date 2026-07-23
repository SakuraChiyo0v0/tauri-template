# Design: module-data-portability (Host SDK V9)

## 目标

- 让用户能导出单个运行时模块的全部数据（隔离 SQLite + 私有设置）并在需要时恢复。
- 复用既有外部文件 grant 机制，模块不接触真实路径。
- V2–V8 模块行为完全不变。

## 非目标

- 不做跨模块或全量批量备份；一次只迁一个模块。
- 不做自动定时备份或云端同步。
- 不允许导入其他模块的归档（按模块 ID 校验）。
- 不在导入时自动重载模块代码；重载由既有停用/启用流程驱动。

## 关键决策

### 1. 归档格式

单个 `.mtbk` 归档文件（module-tauri backup）包含：魔数、版本、模块 ID、导出时间、SQLite 数据库字节（按 `schema_version` 当前内容）、私有设置 JSON。格式为带头部 JSON + 二进制 SQLite 的简单包，或直接复用既有 ZIP 打包。决策：用最小自描述二进制——头部 JSON（`{ magic, version, moduleId, exportedAt, settingsJson, dbSize }`）后跟 SQLite 文件字节。基座校验头部魔数与模块 ID 后再恢复。

### 2. grant 边界

导出与导入都通过用户主动选择文件生成的不透明 grant ID。`exportBackup()` 由基座调用系统保存对话框得到目标路径，写入归档，返回 grant 摘要（文件名、大小，不含真实路径）；`importBackup(grantId)` 使用既有外部文件 grant（read）读取归档。模块只持有 grant ID，不接触路径。不引入新原生能力；外部文件 `read`/`write` 已是既有能力，本变更复用模块清单中应已声明的外部文件读写能力（若未声明则导出/导入不可用，返回明确错误）。

### 3. 归属校验

导入时基座 MUST 校验归档头部的 `moduleId` 与当前调用模块一致；不一致拒绝恢复，防止把 A 模块的数据导入 B 模块。同时校验归档格式版本与魔数。

### 4. 恢复流程

导入时基座 MUST 确保模块当前没有活动数据库连接：通过既有启停流程要求模块处于非活动状态，或由前端先停用模块再调用导入。基座在写入前覆盖模块数据库文件并写入设置，完成后返回结果。重新激活模块时既有加载流程按新数据重建 schema 版本与连接。决策：导入命令在模块仍有活动会话时返回 `module_still_active` 错误，由前端负责先停用；这避免在运行中覆盖数据库导致损坏。

### 5. SDK 形态

V9 模块获得 `sdk.data`：
- `exportBackup(): Promise<{ grantId: string; displayName: string; size: number } | null>` — 用户取消返回 null。
- `importBackup(grantId: string): Promise<void>` — 校验恢复。

### 6. 后端实现

新增 `src-tauri` `data_portability.rs`：`export_module_backup(app, module_id)` 触发保存对话框，读取模块数据库文件字节 + 私有设置，写归档；`import_module_backup(app, module_id, grant_id)` 校验并恢复。复用 `ModuleDatabaseManager::database_path` 与模块设置存储。会话令牌权限校验沿用既有外部文件 grant 校验。

## 风险与权衡

- 导入覆盖数据库有数据丢失风险；用户主动选择文件且模块须先停用，操作显式可见。
- 归档格式版本化，未来结构变化需要版本协商；本次定义版本 1，后续破坏性变化换新版本号。
