## ADDED Requirements

### Requirement: V5 模块可以请求只读仓库目录授权
获批 Host SDK V5 模块 SHALL 能够调用基座目录选择器创建模块专属的只读目录 grant。Host SDK MUST 只返回 grant ID、显示名称、类型和访问标志，不得向模块暴露真实路径。

#### Scenario: 选择仓库目录
- **WHEN** 模块在用户操作后请求仓库目录且用户选择有效目录
- **THEN** 系统 SHALL 创建只允许读取和列举的模块专属目录 grant

#### Scenario: 使用其他模块的仓库 grant
- **WHEN** 会话提交属于另一模块的目录 grant
- **THEN** 系统 MUST 返回 `grant_owner_mismatch` 且不枚举或读取该目录

#### Scenario: 撤销仓库授权
- **WHEN** 用户撤销市场模块持有的目录 grant
- **THEN** 旧 grant ID 的后续扫描和安装请求 SHALL 立即失败
