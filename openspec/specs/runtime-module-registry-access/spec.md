# runtime-module-registry-access Specification

## Purpose
TBD - created by archiving change runtime-module-native-capabilities-v1. Update Purpose after archive.
## Requirements
### Requirement: 注册表访问必须限制平台、hive 和键前缀
注册表能力 MUST 只在 Windows 上可用。模块清单 MAY 声明 HKCU 范围的读写或 HKLM 范围的只读前缀；底座 MUST 拒绝其他 hive、远程注册表、HKLM 写入和超出批准前缀的目标。

#### Scenario: 读取批准 HKCU 范围
- **WHEN** Windows 上的活动模块读取其批准 HKCU 前缀内的值
- **THEN** 底座返回支持的注册表值类型及数据

#### Scenario: 拒绝 HKLM 写入
- **WHEN** 模块声明或调用 HKLM 写入
- **THEN** 清单校验或运行调用失败，目标注册表保持不变

#### Scenario: 拒绝前缀逃逸
- **WHEN** 模块通过不同分隔符、空段或父级语义尝试访问批准前缀之外的键
- **THEN** 底座规范化后拒绝操作且不打开越界键

### Requirement: 注册表写入必须限制值和删除范围
HKCU 读写 scope MUST 支持字符串、DWORD、QWORD、二进制和多字符串值。模块 MAY 在批准前缀内设置或删除单个值，但 MUST NOT 递归删除键树、修改键权限或创建符号链接键。

#### Scenario: 写入并读取 HKCU 值
- **WHEN** 模块在批准的 HKCU scope 设置支持类型的值后读取
- **THEN** 底座返回相同类型和值

#### Scenario: 拒绝递归键删除
- **WHEN** 模块尝试删除整个键树或改变注册表安全描述符
- **THEN** Host SDK 不提供对应操作且底座拒绝底层请求

### Requirement: 非 Windows 平台必须明确降级
在非 Windows 平台上，V3 Host SDK MUST 保留注册表接口的类型形状，但所有实际操作 SHALL 返回结构化 `unsupported_platform`，不得创建模拟文件或静默成功。

#### Scenario: macOS 或 Linux 调用注册表
- **WHEN** 模块在非 Windows 系统调用注册表接口
- **THEN** 调用返回 `unsupported_platform`，模块可以据此隐藏或降级对应功能
