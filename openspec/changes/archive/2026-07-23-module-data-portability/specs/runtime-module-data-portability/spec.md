## ADDED Requirements

### Requirement: 模块数据导出必须经用户选择并使用不透明 grant
SDK V9 模块通过 `sdk.data.exportBackup()` 请求基座把自身隔离 SQLite 数据库与私有设置导出为单个归档文件。基座 MUST 通过系统保存对话框由用户选择目标位置，模块只收到不透明 grant 摘要（文件名与大小），不得获得真实路径。导出归档 MUST 包含魔数、格式版本、模块 ID、导出时间、私有设置 JSON 与数据库字节。

#### Scenario: 导出模块数据
- **WHEN** V9 模块调用 `exportBackup()` 且用户在系统对话框选择保存位置
- **THEN** 基座写入归档文件并返回不透明 grant 摘要，模块无法获知真实路径

#### Scenario: 用户取消导出
- **WHEN** 用户在保存对话框取消
- **THEN** `exportBackup()` 返回 null 且不写入任何文件

### Requirement: 模块数据导入必须校验归属与格式
`sdk.data.importBackup(grantId)` MUST 只接受用户授权读取的外部文件 grant。基座 MUST 校验归档魔数、格式版本与头部的模块 ID 与当前调用模块一致；不一致或不合法时拒绝恢复且不改动现有数据。

#### Scenario: 恢复本模块归档
- **WHEN** 模块用已授权的、由本模块先前导出的归档 grant 调用 `importBackup`
- **THEN** 基座校验通过后覆盖该模块的数据库与私有设置

#### Scenario: 拒绝其他模块归档
- **WHEN** 归档头部模块 ID 与当前调用模块不一致
- **THEN** 恢复被拒绝且现有数据保持不变

#### Scenario: 拒绝非法归档
- **WHEN** grant 指向的文件不是合法模块备份归档
- **THEN** 恢复被拒绝并返回格式错误

### Requirement: 导入必须避免覆盖运行中的数据库
模块仍有活动数据库连接时 `importBackup` MUST 返回 `module_still_active` 错误，不得覆盖文件。模块 SHOULD 先停用自身（通过既有停用流程）再导入；导入完成后重新启用按既有加载流程以新数据重建连接。

#### Scenario: 模块仍活动时拒绝导入
- **WHEN** 模块当前有活动原生活会话且调用 `importBackup`
- **THEN** 调用返回 `module_still_active` 且不修改任何数据

#### Scenario: 停用后导入再启用
- **WHEN** 模块停用后导入归档再重新启用
- **THEN** 模块按归档数据重建数据库连接与设置，原有运行中数据被归档数据覆盖

### Requirement: 数据迁移必须随模块生命周期清理
基座 MUST 在模块激活失败、停用、卸载或计划重载时使该模块的数据迁移会话失效；失效后的模块 MUST NOT 继续导出或导入，已写入磁盘的归档文件由用户管理。

#### Scenario: 模块停用后迁移失效
- **WHEN** 模块 Host SDK 被释放后调用 `exportBackup` 或 `importBackup`
- **THEN** 调用返回会话失效错误
