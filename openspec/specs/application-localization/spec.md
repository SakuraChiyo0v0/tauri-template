# application-localization Specification

## Purpose
TBD - created by archiving change add-bilingual-i18n. Update Purpose after archive.
## Requirements
### Requirement: 底座必须提供中文和英文语言状态
底座 MUST 只支持简体中文（`zh-CN`）和英文（`en`），首次启动 SHALL 使用简体中文。用户选择 MUST 持久化，并在后续启动时恢复，同时同步到文档语言属性。

#### Scenario: 首次启动
- **WHEN** 本地没有保存语言选择
- **THEN** 底座使用 `zh-CN` 渲染并把文档 `lang` 设置为 `zh-CN`

#### Scenario: 保存并恢复英文
- **WHEN** 用户在设置中选择英文后重新启动应用
- **THEN** 底座恢复 `en`、以英文渲染并把文档 `lang` 设置为 `en`

#### Scenario: 拒绝未知语言
- **WHEN** 持久化数据或调用方提供 `zh-CN` 与 `en` 之外的值
- **THEN** 底座回退到 `zh-CN` 且不暴露未知语言状态

### Requirement: 语言切换必须即时更新底座界面
设置页面 MUST 提供中文和英文选项。用户切换语言后，应用外壳、侧边栏、页面标题、内置模块贡献、设置、主题控件、日志控制台、模块管理和用户提示 SHALL 在不重启、不重载 WebView和不改变模块激活计划的情况下更新。

#### Scenario: 从中文切换到英文
- **WHEN** 用户在设置页把语言从中文切换为英文
- **THEN** 当前可见底座文案和内置模块贡献立即变为英文，当前页面与模块启用状态保持不变

#### Scenario: 从英文切换回中文
- **WHEN** 用户把语言从英文切换为中文
- **THEN** 当前可见底座文案和内置模块贡献立即恢复中文

### Requirement: 源码模块必须声明完整双语文案
每个源码模块 MUST 为模块名称、说明、导航、设置标签、设置说明和选择项标签提供非空的 `zh-CN` 与 `en` 文案。底座 SHALL 在当前语言下解析贡献，不允许业务模块把文案写入共享设置页或外壳。

#### Scenario: 注册完整双语源码模块
- **WHEN** 源码模块为全部用户可见贡献提供中文和英文
- **THEN** 类型检查通过，模块贡献随底座语言切换显示对应文案

#### Scenario: 源码模块缺少英文
- **WHEN** 新源码模块的任一必需用户文案没有 `en`
- **THEN** TypeScript 类型检查或聚焦契约测试失败

### Requirement: 底座词典必须覆盖用户可见文案
底座 SHALL 通过类型化词典提供自身用户可见文案和参数化消息。开发日志、Rust 原始错误细节、模块 ID、路径和用户数据 MAY 保持原始形式。

#### Scenario: 两种语言执行主要页面
- **WHEN** 测试分别以 `zh-CN` 与 `en` 渲染设置、日志和模块管理主要状态
- **THEN** 按钮、标题、说明、空状态和确认提示使用当前语言且不存在缺失词条
