## ADDED Requirements

### Requirement: 授权模块安装必须复用完整包生命周期
系统 MUST 允许获得本地模块仓库权限的 Host SDK V5 模块从自己的目录 grant 安装顶层 `.mtp`，并 MUST 对扫描和最终安装分别执行现有包校验。安装结果 SHALL 复用版本不可变、依赖解析、权限等待、激活失败恢复和回滚规则。

#### Scenario: 从授权仓库安装有效包
- **WHEN** 获批 V5 模块提交属于自己的目录 grant 和其中一个顶层 `.mtp` 文件名
- **THEN** 系统 SHALL 重新校验包并通过现有 ModuleStore 安装，返回新的全局计划和模块状态

#### Scenario: 拒绝路径构造
- **WHEN** 模块提交子目录、绝对路径、父目录跳转、非 `.mtp` 文件或不属于自己的 grant
- **THEN** 系统 MUST 在读取或安装前拒绝请求，现有版本和激活计划保持不变

#### Scenario: 扫描后包被替换
- **WHEN** 包在扫描成功后、安装前被替换为无效或不同内容
- **THEN** 最终安装 SHALL 以当前文件重新校验并拒绝无效内容，不信任扫描结果
