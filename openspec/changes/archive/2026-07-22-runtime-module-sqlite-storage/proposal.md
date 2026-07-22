## Why

运行时模块目前只能把少量设置保存在 WebView `localStorage`，无法可靠保存结构化业务数据、执行事务或管理数据迁移。底座需要提供受控的 SQLite 能力，让独立模块可以持久化数据，同时保持模块之间、模块与宿主文件系统之间的隔离。

## What Changes

- 底座新增 SQLite 存储服务，为每个运行时模块创建独立数据库文件，并由底座控制路径、连接和生命周期。
- 新增 Host SDK V2 数据库接口，提供参数化查询、执行和事务；Host SDK V1 模块继续按原协议运行。
- 拒绝跨数据库附加、扩展加载和其他突破模块数据边界的 SQL 能力。
- 模块卸载默认保留业务数据；模块管理界面展示数据占用并提供需要明确确认的清除操作。
- 数据清除不得删除模块目录、其他模块数据库或底座公共数据。
- 不实现跨模块表访问或模块服务调用；后续通过版本化服务层共享数据，而不是直接查询其他模块数据库。

## Capabilities

### New Capabilities

- `runtime-module-sqlite-storage`: 定义模块隔离 SQLite、Host SDK V2 数据访问、安全 SQL 边界、事务和数据清理行为。

### Modified Capabilities

- `runtime-module-contributions`: 扩展宿主 SDK 版本协商，使 V1 模块保持原能力，V2 模块获得隔离数据库接口。
- `module-package-lifecycle`: 调整卸载后的数据保留语义，并在模块管理界面增加数据占用和显式清理操作。

## Impact

- Rust 底座新增 SQLite 依赖、模块数据库管理器和 Tauri 命令。
- 运行时模块清单、TypeScript Host SDK 类型、SDK 构造器和激活测试需要支持 V1/V2 协商。
- 模块管理页面和运行时模块 API 增加数据库占用查询与数据清理。
- 应用数据目录新增按模块 ID 隔离的数据库文件；现有模块包、安装状态和 V1 数据保持兼容。
- 独立 `tauri-module-template` 需要补充 V2 SDK 类型和真实数据库验证模块，但仍不引用底座源码。
