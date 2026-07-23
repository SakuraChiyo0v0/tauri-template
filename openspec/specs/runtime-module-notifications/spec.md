# runtime-module-notifications Specification

## Purpose
TBD - created by archiving change native-notifications. Update Purpose after archive.
## Requirements
### Requirement: 模块必须声明并获批系统通知能力
SDK V8 模块 MUST 在清单 `nativeCapabilities.notifications` 中声明 `system: true` 才能请求系统通知。底座 MUST 把通知能力纳入指纹、摘要与权限审批流程；未批准的模块 MUST NOT 发出通知。不声明通知能力的 V8 模块不需要空审批。底座 MUST 拒绝 V2–V7 模块声明通知能力。

#### Scenario: 声明并获批通知能力
- **WHEN** SDK V8 模块在清单声明 `notifications.system` 且用户在模块管理页批准
- **THEN** 模块获得 `sdk.notifications.show` 调用资格

#### Scenario: 拒绝低版本模块声明通知
- **WHEN** SDK V2–V7 模块清单包含 `notifications` 声明
- **THEN** 清单校验失败且模块不会安装

#### Scenario: 未批准时拒绝发送
- **WHEN** 模块声明了通知能力但当前权限未批准或已撤销
- **THEN** `sdk.notifications.show` 调用返回权限错误且不发出通知

### Requirement: 通知内容必须受限且校验
`sdk.notifications.show` 的标题与正文 MUST 为有限长度的非控制字符纯文本，底座 MUST 截断并校验。底座 MUST NOT 附加模块数据库内容或机密数据；通知内容完全由模块提供。投递失败 MUST 抛出错误，模块 SHOULD 以 `warn` 记录而非中断自身流程。

#### Scenario: 发送合法通知
- **WHEN** 获批模块调用 `show({ title: "完成", body: "同步已结束" })`
- **THEN** 底座向操作系统发出一条标题为“完成”、正文为“同步已结束”的系统通知

#### Scenario: 截断超长内容
- **WHEN** 标题或正文超过底座上限
- **THEN** 底座按上限截断后发出通知，不因长度拒绝合法调用

#### Scenario: 拒绝非法内容
- **WHEN** 标题为空、非字符串或包含控制字符
- **THEN** 调用抛出内容校验错误且不发出通知

### Requirement: 通知能力必须随模块生命周期清理
底座 MUST 在模块激活失败、停用、卸载、版本切换、权限撤销或 WebView 计划重载时使该模块的通知会话失效。失效后的模块 MUST NOT 发出新通知；已发出的通知由操作系统管理，底座不负责撤回。

#### Scenario: 模块停用后停止发送
- **WHEN** 模块 Host SDK 被释放后再次调用 `show`
- **THEN** 调用返回会话失效错误且不发出新通知

