# runtime-module-operation-logging Specification

## Purpose
TBD - created by archiving change add-module-operation-logging. Update Purpose after archive.
## Requirements
### Requirement: Modules report through the Host SDK
运行时模块 MUST 通过 `hostSdk.logger` 报告模块日志，使基座能够以模块 ID 作为日志来源统一收集；模块不得把 `console` 或直接原生日志调用作为关键操作的唯一日志路径。

#### Scenario: Successful module operation is collected
- **WHEN** 用户发起一个模块定义的关键操作并且操作成功
- **THEN** 模块 SHALL 通过 Host SDK 以 `info` 级别写入一条能够识别操作类型的日志
- **THEN** 基座日志控制台 SHALL 以该模块 ID 显示日志来源

### Requirement: Modules distinguish operation outcomes
运行时模块 MUST 根据操作结果选择日志级别，并保证默认 `info` 阈值下仍能看到关键成功操作。

#### Scenario: Recoverable operation cannot proceed
- **WHEN** 操作因无效输入、缺少目标、用户取消或依赖暂不可用而未执行
- **THEN** 模块 SHALL 以 `warn` 级别记录可恢复结果

#### Scenario: Operation fails unexpectedly
- **WHEN** 数据库、模块服务或受控原生能力调用失败
- **THEN** 模块 SHALL 以 `error` 级别记录失败的操作类型

### Requirement: Module logs protect sensitive data
运行时模块 MUST 采用最小必要日志内容，并且 MUST NOT 记录笔记正文、凭据、令牌、完整 URL、文件系统路径、服务负载或其他不必要的用户数据。

#### Scenario: Operation includes user-owned content
- **WHEN** 模块记录涉及笔记、地址、文件或服务数据的操作结果
- **THEN** 日志 SHALL 只包含稳定操作名称及非敏感结果信息
- **THEN** 日志 SHALL NOT 包含操作所处理的原始用户内容

### Requirement: Standalone module template teaches the logging contract
独立模块模板 MUST 在 AI 开发规范、开发说明、示例模块和聚焦测试中展示模块操作日志约定。

#### Scenario: Developer starts from the module template
- **WHEN** 开发者或 AI 使用独立模块模板增加新的关键操作
- **THEN** 模板 SHALL 指导其通过 Host SDK 记录成功、可恢复结果和失败
- **THEN** 模板 SHALL 明确禁止将敏感信息写入日志

### Requirement: Reference modules expose useful operation logs
本地笔记、数据面板和快捷启动参考模块 MUST 为各自主要用户操作报告日志，同时保持现有功能行为。

#### Scenario: User operates a reference module
- **WHEN** 用户保存或删除笔记、刷新数据面板、保存启动目标或触发打开操作
- **THEN** 对应模块 SHALL 记录操作的成功或未成功结果
- **THEN** 日志 SHALL 遵守敏感数据保护要求
