# runtime-module-events Specification

## Purpose
TBD - created by archiving change module-event-bus. Update Purpose after archive.
## Requirements
### Requirement: 模块必须显式声明事件
schema V2 / SDK V7 模块 MUST 在清单 `events.publishes` 与 `events.subscribes` 中声明允许发布和订阅的事件 ID。事件 ID MUST 使用与服务 ID 相同的格式（例如 `notes.changed.v1`）。底座 MUST 拒绝声明重复、格式无效的事件 ID，并 MUST 拒绝 SDK V7 以下模块声明事件。

#### Scenario: 声明合法事件
- **WHEN** SDK V7 模块在清单声明不重复且格式合法的事件 ID
- **THEN** 清单校验通过，模块获得对应发布与订阅资格

#### Scenario: 拒绝低版本模块声明事件
- **WHEN** SDK V2–V6 模块清单包含 `events` 声明
- **THEN** 清单校验失败且模块不会安装

#### Scenario: 拒绝重复或非法事件 ID
- **WHEN** 清单中事件 ID 重复或不符合事件 ID 格式
- **THEN** 清单校验失败并指明非法 ID

### Requirement: 事件发布必须受清单声明约束
SDK V7 模块 SHALL 通过 Host SDK `events.publish()` 发布事件。底座 MUST 拒绝发布清单未声明或格式非法的事件 ID，发布失败后不得向任何订阅者投递。

#### Scenario: 发布已声明事件
- **WHEN** 活动模块发布清单已声明的事件并携带合法载荷
- **THEN** 底座接受该事件并异步投递给当前订阅者

#### Scenario: 拒绝未声明事件
- **WHEN** 模块发布清单未声明的事件 ID
- **THEN** 发布失败且没有任何订阅者收到该事件

### Requirement: 事件订阅必须按声明的事件 ID 全局匹配
SDK V7 模块 SHALL 通过 Host SDK `events.subscribe()` 订阅清单已声明的事件 ID。订阅 MUST NOT 要求把发布者声明为模块依赖；任何活动模块发布的同一事件 ID 都会投递给订阅者。底座 MUST 拒绝订阅未声明的事件 ID。订阅 MUST 返回退订函数，重复订阅同一事件各自独立退订。

#### Scenario: 订阅者收到匹配事件
- **WHEN** 两个模块分别声明同一事件的发布与订阅且都处于活动状态
- **THEN** 发布者发布事件后，订阅者监听器收到该事件

#### Scenario: 跨模块订阅无需依赖声明
- **WHEN** 订阅者清单未把发布者列为依赖，但双方声明了同一事件 ID
- **THEN** 事件仍然正常投递

#### Scenario: 拒绝未声明订阅
- **WHEN** 模块订阅清单未声明的事件 ID
- **THEN** 订阅失败且不注册任何监听器

### Requirement: 事件数据必须隔离且来源可信
事件载荷 MUST 仅包含与模块服务相同的受限 JSON 值，并 MUST 在投递边界深度复制。底座 MUST 拒绝函数、类实例、循环引用、危险原型键、非有限数字、过深结构或超限数据。投递给订阅者的事件信封 MUST 由底座构造，包含事件 ID、发布者模块 ID 和发布时间；模块不得伪造发布者身份。

#### Scenario: 投递隔离副本
- **WHEN** 发布者携带合法对象载荷发布事件
- **THEN** 每个订阅者收到内容相同但引用互相隔离、且与发布者隔离的副本

#### Scenario: 拒绝非法载荷
- **WHEN** 事件载荷包含函数、循环引用或其他不受支持值
- **THEN** 发布失败且不进行任何投递

#### Scenario: 信封标识真实发布者
- **WHEN** 订阅者收到事件
- **THEN** 信封中的发布者模块 ID 与实际发布模块一致，与载荷中可能声明的任何身份无关

### Requirement: 事件投递必须异步且隔离故障
底座 MUST 异步投递事件，单个订阅者监听器抛出的异常 MUST NOT 影响同一事件的其他订阅者，并 SHALL 记录带模块与事件上下文的日志（不记录载荷内容）。同一发布者的事件 SHALL 按发布顺序投递给同一订阅者。

#### Scenario: 订阅者异常不影响其他订阅者
- **WHEN** 一个订阅者监听器抛出异常而另一个订阅者正常
- **THEN** 正常订阅者仍收到事件，异常被记录到底座日志

#### Scenario: 保持单发布者顺序
- **WHEN** 同一发布者连续发布两个同一事件 ID 的事件
- **THEN** 订阅者按发布先后次序收到这两个事件

### Requirement: 事件订阅必须随模块生命周期清理
底座 MUST 在模块激活失败、停用、卸载、版本切换或 WebView 计划重载时退订该模块的全部订阅。释放后的模块 MUST NOT 再收到事件，其发布调用 MUST 被拒绝。未激活期间发布的事件 MUST NOT 在模块重新激活后补投。

#### Scenario: 模块停用后停止接收
- **WHEN** 订阅者 Host SDK 被释放后发布者继续发布同一事件
- **THEN** 已停用模块的监听器不再被调用，其他活动订阅者不受影响

#### Scenario: 激活失败清理订阅
- **WHEN** 模块订阅事件后在 `activate` 中抛出错误
- **THEN** 底座释放 SDK、退订其全部订阅并进入现有激活失败恢复流程

#### Scenario: 不补投离线事件
- **WHEN** 模块停用期间有事件发布后模块重新激活
- **THEN** 模块只收到重新激活之后发布的事件

