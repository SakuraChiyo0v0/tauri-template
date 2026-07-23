# runtime-module-filesystem-access Specification

## Purpose
TBD - created by archiving change runtime-module-native-capabilities-v1. Update Purpose after archive.
## Requirements
### Requirement: 模块私有文件必须限制在专属根目录
底座 MUST 为每个获批 V3 模块提供独立私有文件根目录。私有文件 API MUST 只接受安全相对路径，并拒绝绝对路径、父目录跳转、符号链接逃逸和其他模块目录访问。

#### Scenario: 读写模块私有文件
- **WHEN** 活动模块使用安全相对路径写入并读取私有文件
- **THEN** 数据只落在该模块专属文件根目录，重启后仍可读取

#### Scenario: 拒绝私有目录逃逸
- **WHEN** 模块提交绝对路径、包含 `..` 的路径或经过符号链接指向根目录外
- **THEN** 底座在访问目标前返回路径边界错误，根目录外文件保持不变

### Requirement: 外部文件访问必须使用用户选择授权
私有根目录之外的文件和目录 MUST 由底座文件选择器创建模块专属 grant。Host SDK SHALL 只返回不透明 grant ID、显示名称、类型和批准操作，不得把任意路径参数作为后续访问授权。

#### Scenario: 用户授予外部文件读取
- **WHEN** 模块请求文件读取且用户在底座选择器中选择文件
- **THEN** 底座创建只属于该模块的读取 grant，模块可以通过 grant ID 读取该文件

#### Scenario: 用户取消选择
- **WHEN** 用户关闭选择器而未选择目标
- **THEN** Host SDK 返回取消结果，不创建 grant 且不读取任何文件

#### Scenario: 跨模块使用 grant
- **WHEN** 另一个模块会话提交不属于自己的 grant ID
- **THEN** 底座返回资源归属错误且不访问授权目标

### Requirement: 文件操作必须有界且避免部分写入
文件 API MUST 限制单次读取、写入、目录枚举和二进制结果大小。写入外部或私有文件时，底座 SHALL 在同一目录写入临时文件并在成功后替换目标；失败时不得留下部分目标内容。

#### Scenario: 原子写入成功
- **WHEN** 模块写入未超过上限且目标 grant 允许写入
- **THEN** 完整新内容替换目标并返回写入字节数

#### Scenario: 数据超过上限
- **WHEN** 模块尝试读取或写入超过底座固定上限的数据
- **THEN** 操作返回资源超限错误，目标文件内容保持不变

### Requirement: 文件授权必须可查看和撤销
模块管理界面 SHALL 展示模块持有的外部文件与目录 grant，并允许用户逐项撤销。撤销后所有旧 grant ID MUST 立即失效，私有模块数据不受影响。

#### Scenario: 撤销外部目录授权
- **WHEN** 用户撤销模块的目录 grant
- **THEN** 后续目录枚举和子文件访问返回权限错误，模块私有目录仍可正常使用

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
