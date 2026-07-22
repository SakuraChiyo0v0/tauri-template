# runtime-module-sqlite-storage Specification

## Purpose

定义底座通过 Host SDK V2 为运行时模块提供隔离 SQLite 数据库时的持久化接口、安全边界、资源限制与用户数据管理行为。

## Requirements

### Requirement: 底座必须为模块隔离 SQLite 数据
底座 MUST 为每个使用 Host SDK V2 数据库能力的运行时模块分配独立 SQLite 文件。数据库路径 MUST 只由底座根据已校验模块 ID 生成，模块不得提供文件路径、访问其他模块数据库或访问底座公共数据。

#### Scenario: 首次访问创建模块数据库
- **WHEN** 已安装的 V2 模块首次执行数据库操作
- **THEN** 底座在该模块专属数据目录创建 SQLite 数据库并完成操作

#### Scenario: 两个模块使用同名表
- **WHEN** 两个 V2 模块分别创建名称相同的表并写入数据
- **THEN** 每个模块只读取自己的表和数据，双方数据库文件互不影响

#### Scenario: 重启后读取数据
- **WHEN** 模块写入数据后应用退出并重新启动
- **THEN** 模块通过同一 Host SDK 接口读取到先前提交的数据

### Requirement: Host SDK V2 必须提供参数化数据库操作
Host SDK V2 MUST 提供单语句参数化执行、只读查询、原子事务和 schema 用户版本接口。底座 MUST 将 SQLite 值转换为规定的 JSON 兼容类型，并以结构化错误报告无效参数、SQL 错误和资源超限。

#### Scenario: 参数化写入和查询
- **WHEN** V2 模块使用占位符和参数创建记录并执行只读查询
- **THEN** 写入结果返回影响行数，查询结果按列名返回该模块数据库中的匹配行

#### Scenario: 事务全部成功
- **WHEN** 模块提交的事务中每条语句都合法并执行成功
- **THEN** 底座原子提交全部语句并返回每条语句的执行结果

#### Scenario: 事务中途失败
- **WHEN** 事务中的任一语句校验或执行失败
- **THEN** 底座回滚该事务中的全部修改并返回失败语句的结构化错误

#### Scenario: 管理 schema 用户版本
- **WHEN** 模块读取或设置非负的 schema 用户版本
- **THEN** 底座通过受控接口读写该模块数据库的 `user_version`，模块无需执行 PRAGMA

#### Scenario: 查询结果超过上限
- **WHEN** 查询返回的行数或序列化数据超过底座规定上限
- **THEN** 操作失败并返回资源超限错误，不把无界结果传入 WebView

### Requirement: 底座必须阻止越过数据库边界的 SQL
底座 MUST 对每条模块 SQL 使用 SQLite authorizer 和单语句 prepared 执行。系统 SHALL 拒绝数据库附加或分离、任意 PRAGMA、扩展加载、多语句脚本、非只读查询接口写入，以及对非本模块数据库的访问。

#### Scenario: 拒绝附加外部数据库
- **WHEN** 模块执行 `ATTACH`、`DETACH` 或尝试引用非 `main`/`temp` 数据库
- **THEN** 底座在访问目标文件前拒绝语句，本模块和其他文件保持不变

#### Scenario: 拒绝危险 PRAGMA 和扩展加载
- **WHEN** 模块通过通用执行接口请求 PRAGMA 或加载 SQLite 扩展
- **THEN** 底座拒绝操作并返回安全边界错误

#### Scenario: 拒绝在查询接口写入
- **WHEN** 模块通过 `select` 接口提交会改变数据库的语句
- **THEN** 底座在执行前拒绝该语句，数据库内容保持不变

#### Scenario: 拒绝多语句脚本
- **WHEN** 模块在一次调用中提交多条 SQL 语句
- **THEN** 底座拒绝整个调用，不执行其中任何语句

### Requirement: 模块数据必须独立统计和显式清理
底座 SHALL 统计每个模块数据库主文件及 SQLite sidecar 的总字节数，并 MUST 只在模块已停用或已卸载且用户明确确认后清理该模块数据。清理不得改变模块代码、激活计划、其他模块数据库或底座公共数据。

#### Scenario: 查看已安装模块数据占用
- **WHEN** 模块已经创建数据库
- **THEN** 模块管理界面显示该模块数据库及 sidecar 的当前总占用

#### Scenario: 查看已卸载模块保留数据
- **WHEN** 模块代码已卸载但专属数据库仍存在
- **THEN** 模块管理界面继续显示模块 ID、数据占用和清理入口

#### Scenario: 拒绝清理活动模块数据
- **WHEN** 用户尝试清理仍在激活计划中的模块数据
- **THEN** 底座拒绝操作并提示先停用模块，数据库保持不变

#### Scenario: 清理停用或已卸载模块数据
- **WHEN** 用户明确确认清理停用或已卸载模块的数据
- **THEN** 底座只删除该模块数据库及 sidecar，并从数据清单移除该条目
