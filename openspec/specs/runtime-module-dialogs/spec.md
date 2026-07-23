# runtime-module-dialogs Specification

## Purpose
TBD - created by archiving change module-dialogs. Update Purpose after archive.
## Requirements
### Requirement: 模块对话框必须由外壳托管并串行显示
SDK V11 模块通过 `sdk.dialogs.confirm` / `sdk.dialogs.prompt` 请求模态对话框。底座 MUST 在应用主窗口内由外壳渲染覆盖层，并 MUST 串行处理多个对话框请求（同一时刻只显示一个），避免焦点混乱。模块 MUST NOT 自行渲染模态覆盖层绕过该边界。

#### Scenario: 请求确认对话框
- **WHEN** 模块调用 `confirm({ title, message })` 且用户点击确认
- **THEN** 调用以 `true` 完成

#### Scenario: 请求输入对话框
- **WHEN** 模块调用 `prompt({ title, message })` 且用户输入文本后确认
- **THEN** 调用以该文本完成；用户取消则以 `null` 完成

#### Scenario: 串行显示多个对话框
- **WHEN** 两个对话框请求同时到达
- **THEN** 底座按先后次序逐个显示，后一个在前一个关闭后才出现

### Requirement: 对话框内容必须受限且安全
标题、消息、按钮文案与输入默认值/占位符 MUST 为有限长度字符串，底座 MUST 截断并按纯文本渲染（转义，不执行 HTML 或脚本）。按钮文案缺失时底座 SHALL 提供双语默认值。

#### Scenario: 缺省按钮文案
- **WHEN** 模块未提供 `confirmLabel` / `cancelLabel`
- **THEN** 底座显示双语默认确认与取消文案

#### Scenario: 截断超长内容
- **WHEN** 标题或消息超过底座上限
- **THEN** 底座按上限截断后显示，不因长度拒绝合法调用

### Requirement: 对话框必须支持键盘操作
底座 MUST 允许 Esc 取消对话框（`confirm→false`、`prompt→null`）；`prompt` MUST 允许 Enter 提交当前输入。焦点 MUST 被限制在对话框内直到关闭。

#### Scenario: Esc 取消
- **WHEN** 对话框打开且用户按 Esc
- **THEN** 对话框以取消结果关闭

#### Scenario: Enter 提交输入
- **WHEN** `prompt` 对话框打开且用户按 Enter
- **THEN** 对话框以当前输入文本完成

### Requirement: 对话框必须随模块生命周期清理
底座 MUST 在模块激活失败、停用、卸载或计划重载时取消该模块未关闭的对话框（`confirm→false`、`prompt→null`）并从容器移除。释放后的模块 MUST NOT 发起新对话框。

#### Scenario: 模块停用后取消未关闭对话框
- **WHEN** 模块 Host SDK 被释放且仍有未关闭的对话框
- **THEN** 对话框以取消结果完成并从容器移除

#### Scenario: 释放后拒绝新对话框
- **WHEN** 模块 Host SDK 被释放后调用 `confirm` 或 `prompt`
- **THEN** 调用返回会话失效错误

