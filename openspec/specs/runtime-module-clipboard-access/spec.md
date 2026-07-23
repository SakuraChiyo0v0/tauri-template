# runtime-module-clipboard-access Specification

## Purpose
TBD - created by archiving change clipboard-access. Update Purpose after archive.
## Requirements
### Requirement: 模块必须声明并获批剪贴板能力
SDK V10 模块 MUST 在清单 `nativeCapabilities.clipboard` 中声明 `text: true` 才能请求剪贴板文本读写。底座 MUST 把剪贴板能力纳入指纹、摘要与权限审批流程；未批准的模块 MUST NOT 读写剪贴板。底座 MUST 拒绝 V2–V9 模块声明剪贴板能力。

#### Scenario: 声明并获批剪贴板能力
- **WHEN** SDK V10 模块在清单声明 `clipboard.text` 且用户批准
- **THEN** 模块获得 `sdk.clipboard.readText` / `writeText` 调用资格

#### Scenario: 拒绝低版本模块声明剪贴板
- **WHEN** SDK V2–V9 模块清单包含 `clipboard` 声明
- **THEN** 清单校验失败且模块不会安装

#### Scenario: 未批准时拒绝读写
- **WHEN** 模块声明了剪贴板能力但当前权限未批准或已撤销
- **THEN** `readText` / `writeText` 调用返回权限错误且不访问剪贴板

### Requirement: 剪贴板只读写纯文本且内容受边界约束
`sdk.clipboard.writeText` 的入参 MUST 为有限长度字符串，底座 MUST 截断并校验。`readText` MUST 返回纯文本（无内容时返回空串）。底座 MUST NOT 通过剪贴板能力读写富文本、图像或文件格式。

#### Scenario: 写入纯文本
- **WHEN** 获批模块调用 `writeText("hello")`
- **THEN** 系统剪贴板文本被设置为 "hello"

#### Scenario: 读取纯文本
- **WHEN** 获批模块调用 `readText()` 且剪贴板当前为纯文本
- **THEN** 返回该文本；剪贴板为空时返回空串

#### Scenario: 截断超长文本
- **WHEN** 写入文本超过底座上限
- **THEN** 底座按上限截断后写入，不因长度拒绝合法调用

### Requirement: 剪贴板能力必须随模块生命周期清理
底座 MUST 在模块激活失败、停用、卸载、版本切换、权限撤销或计划重载时使该模块的剪贴板会话失效。失效后的模块 MUST NOT 读写剪贴板。

#### Scenario: 模块停用后拒绝读写
- **WHEN** 模块 Host SDK 被释放后再次调用 `readText` 或 `writeText`
- **THEN** 调用返回会话失效错误且不访问剪贴板

### Requirement: 模块不得记录剪贴板内容
模块 MUST NOT 把 `readText` 返回的内容写入模块日志或持久存储；底座只在校验与传输中使用剪贴板文本，不记录其内容。

#### Scenario: 读取内容不入日志
- **WHEN** 模块读取剪贴板并记录操作日志
- **THEN** 日志只含操作名与结果摘要，不含剪贴板正文

