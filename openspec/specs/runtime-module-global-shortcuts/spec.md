# runtime-module-global-shortcuts Specification

## Purpose
TBD - created by archiving change runtime-module-native-capabilities-v1. Update Purpose after archive.
## Requirements
### Requirement: 全局快捷键必须由清单声明并由用户批准
V3 模块 SHALL 声明快捷键 ID、用途说明和默认 accelerator。底座 MUST 在权限摘要中展示这些快捷键，并只为活动、已授权模块注册声明过的 ID。

#### Scenario: 注册默认快捷键
- **WHEN** 模块获批且默认 accelerator 当前可用
- **THEN** 底座注册快捷键并把触发事件路由给该模块会话

#### Scenario: 请求未声明快捷键
- **WHEN** 模块尝试注册清单中不存在的快捷键 ID 或 accelerator
- **THEN** 底座拒绝请求且不改变系统注册状态

### Requirement: 快捷键冲突必须可见且不得抢占
底座 MUST 检测与底座、其他模块及系统的快捷键冲突。冲突时 SHALL 保留先前所有者、让当前模块继续运行但将该快捷键标记为不可用，并在模块管理界面显示原因。

#### Scenario: 两个模块默认快捷键冲突
- **WHEN** 后激活模块请求已由先激活模块注册的 accelerator
- **THEN** 先前注册保持有效，后者收到结构化冲突且应用其余功能继续运行

### Requirement: 用户必须能够禁用或重新绑定快捷键
模块管理界面 SHALL 允许用户禁用单个模块快捷键或选择新的合法 accelerator。覆盖值 MUST 按模块和快捷键 ID 持久化，并在下次激活时优先于默认值。

#### Scenario: 用户解决快捷键冲突
- **WHEN** 用户把冲突快捷键改为当前可用的 accelerator
- **THEN** 底座原子替换该模块绑定并显示为可用

#### Scenario: 用户禁用快捷键
- **WHEN** 用户关闭某个模块快捷键
- **THEN** 底座注销现有绑定且模块不再收到该 ID 的事件

### Requirement: 快捷键必须跟随模块生命周期释放
模块停用、回滚、卸载、激活失败、权限撤销或会话失效时，底座 MUST 注销该模块的全部全局快捷键并清理事件路由。

#### Scenario: 模块停用释放冲突资源
- **WHEN** 拥有快捷键的模块被停用
- **THEN** 对应 accelerator 被注销，其他模块随后可以绑定它
