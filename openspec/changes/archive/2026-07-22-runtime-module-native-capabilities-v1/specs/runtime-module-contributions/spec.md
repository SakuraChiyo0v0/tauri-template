## MODIFIED Requirements

### Requirement: 宿主 SDK 必须提供最小稳定能力
底座 SHALL 根据模块清单声明的 SDK 版本向 `activate` 传入对应的带版本宿主 SDK。V1 SDK MUST 保持模块身份、底座版本、分级日志、本模块设置读写和主题状态订阅；V2 SDK MUST 在 V1 基础上提供模块隔离数据库；V3 SDK MUST 保持 V2 能力并增加经过声明、用户批准和活动会话校验的文件、进程、注册表、托盘和全局快捷键接口。任何版本均不得暴露内部注册表、任意文件系统路径、原始 Tauri invoke、任意 Shell 或动态原生代码加载。

#### Scenario: V1 模块保持原 SDK
- **WHEN** 已安装模块清单声明 `sdkVersion: 1`
- **THEN** 底座传入字面量版本为 1 且不包含数据库或原生能力成员的 V1 SDK

#### Scenario: V2 模块获得数据库能力
- **WHEN** 已安装模块清单声明 `sdkVersion: 2`
- **THEN** 底座传入字面量版本为 2 且包含隔离数据库但不包含 V3 原生能力成员的 V2 SDK

#### Scenario: V3 模块获得已授权原生能力
- **WHEN** 已安装模块清单声明 `sdkVersion: 3`、权限已批准且版本进入激活计划
- **THEN** 底座创建活动会话并传入包含数据库与受控原生能力的 V3 SDK

#### Scenario: 拒绝不支持的 SDK 版本
- **WHEN** 模块清单声明底座不支持的 SDK 版本
- **THEN** 安装校验失败，现有模块版本、权限和激活计划保持不变

#### Scenario: 模块记录日志
- **WHEN** 运行时模块通过宿主 SDK 写入分级日志
- **THEN** 日志使用该模块 ID 作为来源进入统一日志管道和日志控制台

#### Scenario: 模块读写自身设置
- **WHEN** 模块通过 SDK 读写设置
- **THEN** 设置键被限制在该模块 ID 命名空间，并触发现有设置订阅更新

#### Scenario: 主题发生变化
- **WHEN** 用户切换底座主题模式或主题预设
- **THEN** 运行时页面继承最新 CSS 主题变量，已订阅模块收到主题状态变化通知
