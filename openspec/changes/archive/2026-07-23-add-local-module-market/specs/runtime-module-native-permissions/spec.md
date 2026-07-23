## ADDED Requirements

### Requirement: 模块仓库安装必须单独声明和批准
Host SDK V5 模块 MUST 在清单中显式声明本地模块仓库安装能力。系统 MUST 将该能力加入规范化权限、权限指纹和用户可读摘要；未批准时模块不得扫描包清单或安装模块。

#### Scenario: 首次安装市场模块
- **WHEN** V5 模块声明本地模块仓库安装能力但用户尚未批准
- **THEN** 模块 SHALL 保持等待权限状态，不能创建仓库会话或安装任何包

#### Scenario: 批准市场权限
- **WHEN** 用户查看目录读取与本地模块安装摘要并批准
- **THEN** 系统 SHALL 允许该模块会话使用受限仓库 API

#### Scenario: 普通模块尝试安装
- **WHEN** 未声明或未获批本地模块仓库能力的会话调用扫描或安装命令
- **THEN** 系统 MUST 返回 `permission_denied` 且不读取包或改变安装计划
