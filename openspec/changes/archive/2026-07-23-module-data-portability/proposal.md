## Why

运行时模块的隔离数据库和私有设置目前只在本地存在，用户无法备份、迁移到另一台机器或在异常后恢复。停用模块后虽有清理入口，但缺少把模块数据整体带走或恢复的受控通道。

## What Changes

- 新增 Host SDK V9 模块数据导出/导入能力：模块通过 `sdk.data.exportBackup()` 请求基座把当前隔离 SQLite 数据库与模块私有设置导出为单个文件，保存到用户通过系统对话框选择的位置；通过 `sdk.data.importBackup(grantId)` 从用户之前导出的文件恢复。
- 导出与导入都通过用户主动选择文件生成的不透明 grant ID 进行，模块不能读取真实路径，也不能访问其他模块的数据。导入会校验文件格式与归属，拒绝非本模块导出的文件。
- 能力为纯数据迁移，不新增原生权限审批（复用既有模块私有目录与外部文件 grant 机制）；模块数据范围严格限于自身。
- Host SDK V9 = V8 全部能力 + `data` 命名空间；V2–V8 模块行为完全不变。

## Capabilities

### New Capabilities

- `runtime-module-data-portability`: SDK V9 模块数据导出文件格式、grant 边界、导入校验与恢复流程。

### Modified Capabilities

- `standalone-runtime-module-development`: 模板 Host SDK 类型与模拟宿主从 V8 描述更新到 V9，新增数据导出/导入模拟预览。

## Impact

- 基座原生：`src-tauri` 数据迁移模块（导出 SQLite + 设置为版本化归档、从归档恢复），外部文件 grant。
- 基座前端：清单解析接受 SDK V9，SDK 构建接入 `sdk.data`，释放路径清理。
- 独立仓库：`tauri-module-template`（SDK 类型、清单示例、模拟宿主、测试）。
- 非目标：跨模块批量备份、自动定时备份、云端同步与导入其他模块的文件不在本次范围；导入不自动重载已停用模块的逻辑，重载由既有启停流程驱动。
