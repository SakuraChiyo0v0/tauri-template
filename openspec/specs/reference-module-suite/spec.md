# reference-module-suite Specification

## Purpose

定义底座外三个独立参考模块的可观察行为，用真实可安装模块持续验证隔离数据库、依赖解析、模块服务、双语页面与受控原生能力。
## Requirements
### Requirement: 本地便签模块必须验证数据库与服务提供
`local-notes` 模块 MUST 提供中英文便签页面，使用自身隔离 SQLite 完成新增、编辑、删除和列表读取，并 SHALL 注册 `notes.v1` 服务供依赖模块读取最近便签与统计。模块不得把数据库路径或数据库 SDK 暴露给消费者。

#### Scenario: 管理本地便签
- **WHEN** 用户新增、编辑或删除便签
- **THEN** 页面立即反映变化，数据保存在 `local-notes` 的隔离数据库中

#### Scenario: 提供便签统计服务
- **WHEN** 合法依赖者调用 `notes.v1` 的统计或最近便签方法
- **THEN** 模块从自身数据库读取并返回受限 JSON 结果

#### Scenario: 切换模块语言
- **WHEN** 用户在底座切换中文或英文
- **THEN** 便签页面和状态文案立即使用对应语言，既有便签内容保持原样

### Requirement: 便签面板必须验证依赖与服务消费
`notes-dashboard` 模块 MUST 把 `local-notes` 声明为必需依赖，并 SHALL 仅通过 Host SDK 服务调用读取便签数量、最近更新时间和最近便签，不得直接访问提供者数据库或内部代码。

#### Scenario: 依赖满足时显示统计
- **WHEN** 两个模块版本兼容、均已启用且 `local-notes` 已注册 `notes.v1`
- **THEN** 面板显示统计与最近便签，并允许用户手动刷新

#### Scenario: 提供者缺失时等待
- **WHEN** 只安装或启用 `notes-dashboard` 而没有兼容的 `local-notes`
- **THEN** 依赖解析使面板保持等待且不执行模块入口

#### Scenario: 消费者不取得数据库能力
- **WHEN** 面板读取统计
- **THEN** 调用经过服务总线，面板不能指定或访问 `local-notes` 的数据库

### Requirement: 快捷启动器必须验证受控原生能力
`quick-launcher` 模块 MUST 提供中英文入口管理页面，使用自身 SQLite 保存 HTTPS 入口，并 SHALL 通过已批准的托盘、全局快捷键和 URL scheme 能力打开当前入口。模块不得执行任意 Shell 或未声明 scheme。

#### Scenario: 从页面打开入口
- **WHEN** 用户保存合法 HTTPS 地址并点击打开
- **THEN** 模块通过 Host SDK `process.openUrl` 请求系统打开该地址

#### Scenario: 从快捷键或托盘打开入口
- **WHEN** 用户已批准权限并触发模块声明的快捷键或托盘项目
- **THEN** 模块读取当前入口并通过相同受控 URL 能力打开

#### Scenario: 拒绝不安全地址
- **WHEN** 用户输入非 HTTPS、无效或空白地址
- **THEN** 模块显示双语校验错误且不调用原生打开能力

### Requirement: 验证模块必须保持独立与可打包
三个模块 MUST 位于基座仓库之外的独立 Git 工作区，MUST 通过各自类型检查、关键测试与生产构建，并 SHALL 生成不被 Git 跟踪的 `.mtp` 包。任何模块不得导入基座源码。

#### Scenario: 独立构建模块
- **WHEN** 开发者分别在三个模块目录运行检查和打包命令
- **THEN** 每个模块不读取基座源码即可生成 schema V2 / SDK V4 双语 `.mtp` 包

#### Scenario: 基座仓库保持整洁
- **WHEN** 三个模块被打包并安装测试
- **THEN** 基座 Git 状态不包含模块源码、安装目录或 `.mtp` 产物

### Requirement: 本地便签模块必须发布便签变更事件
`local-notes` 模块 MUST 升级为 Host SDK V7，在清单声明 `notes.changed.v1` 发布资格，并 SHALL 在便签新增、编辑或删除成功写入隔离数据库后发布该事件。事件载荷 MUST 只包含受限 JSON 摘要信息（如变更类型与便签 ID），不得包含数据库路径或完整数据库内容。

#### Scenario: 便签变更后发布事件
- **WHEN** 用户在 `local-notes` 页面新增、编辑或删除便签且数据库写入成功
- **THEN** 模块发布 `notes.changed.v1` 事件，订阅者收到带变更摘要的信封

#### Scenario: 写入失败不发布事件
- **WHEN** 便签写入数据库失败
- **THEN** 模块不发布变更事件并继续显示既有错误提示

### Requirement: 便签面板必须订阅事件自动刷新
`notes-dashboard` 模块 MUST 升级为 Host SDK V7，在清单声明 `notes.changed.v1` 订阅资格，并 SHALL 在收到该事件后自动通过 `notes.v1` 服务重新读取统计与最近便签。面板 MUST 保留手动刷新能力，且事件订阅不得替代对提供者不可用状态的处理。

#### Scenario: 收到事件自动刷新
- **WHEN** 面板处于活动状态并收到 `local-notes` 发布的便签变更事件
- **THEN** 面板自动调用服务刷新显示，无需用户手动刷新

#### Scenario: 面板未激活时不刷新
- **WHEN** 面板模块停用期间发生便签变更
- **THEN** 面板不处理该事件，重新激活后按当前服务数据正常显示

