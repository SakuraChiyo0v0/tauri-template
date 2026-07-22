## MODIFIED Requirements

### Requirement: 宿主 SDK 必须提供双语最小稳定能力
底座 SHALL 只向 schema V2 模块提供 SDK V2、SDK V3 或 SDK V4。SDK V2 MUST 提供模块身份、底座版本、分级日志、本模块设置、主题订阅、当前语言读取与订阅以及模块隔离数据库；V3 SDK MUST 继承全部 V2 能力并增加经过声明、用户批准和活动会话校验的文件、进程、注册表、托盘和全局快捷键接口；V4 SDK MUST 继承全部 V3 能力并增加受依赖约束的模块服务接口。任何版本均不得暴露内部注册表、任意文件系统路径、原始 Tauri invoke、任意 Shell 或动态原生代码加载。

#### Scenario: V2 模块获得双语与数据库能力
- **WHEN** 已安装 schema V2 模块声明 `sdkVersion: 2`
- **THEN** 底座传入字面量版本为 2、包含语言和隔离数据库接口且不包含 V3/V4 能力成员的 SDK

#### Scenario: V3 模块继承语言能力
- **WHEN** schema V2 模块声明 `sdkVersion: 3`、权限已批准且版本进入激活计划
- **THEN** 底座传入包含 V2 语言与数据库能力、受控原生能力且不包含 V4 服务成员的 V3 SDK

#### Scenario: V4 模块获得服务能力
- **WHEN** schema V2 模块声明 `sdkVersion: 4`、所需权限已批准且版本进入激活计划
- **THEN** 底座传入包含全部 V3 能力以及受控模块服务成员的 V4 SDK

#### Scenario: 模块订阅语言变化
- **WHEN** 活动模块订阅 Host SDK i18n 后用户切换底座语言
- **THEN** 模块收到新的 `zh-CN` 或 `en` 值，且无需重新激活即可重绘页面

#### Scenario: 拒绝旧 SDK
- **WHEN** 模块清单声明 `sdkVersion: 1` 或其他不支持版本
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
