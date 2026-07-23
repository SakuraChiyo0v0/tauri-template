## ADDED Requirements

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
