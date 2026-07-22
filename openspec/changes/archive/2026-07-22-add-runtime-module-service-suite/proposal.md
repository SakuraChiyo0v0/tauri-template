## Why

底座已经具备模块安装、依赖、数据库、双语和原生能力，但这些能力主要由协议测试证明，还没有经过一组真实业务模块的连续使用。现在需要用可独立开发的模块验证开发体验，并补上“依赖模块之间如何安全调用”这一关键缺口。

## What Changes

- 新增 Host SDK V4 模块服务能力：提供者显式注册服务，消费者只能调用自己清单中已声明依赖的模块。
- 模块清单新增服务提供声明；服务调用只传递可克隆的 JSON 数据，模块停用时由底座自动注销其服务。
- 模块安装校验接受 SDK V4，并继续保留 SDK V2/V3 运行语义。
- 独立模块模板升级到 SDK V4，包含服务注册、调用与浏览器预览模拟能力。
- 在基座仓库之外创建 `local-notes`、`notes-dashboard` 和 `quick-launcher` 三个独立模块：分别验证 SQLite、模块依赖与服务调用、托盘/快捷键/打开 URL 等原生能力。
- 三个模块均提供中文与英文界面，可独立检查、打包为 `.mtp`，且不会把产物或安装实例提交到基座仓库。

## Capabilities

### New Capabilities

- `runtime-module-services`: 定义模块服务声明、注册、依赖约束调用、数据边界、错误与生命周期清理。
- `reference-module-suite`: 定义三个独立真实模块的用户行为和它们需要验证的底座能力。

### Modified Capabilities

- `runtime-module-contributions`: Host SDK 增加 V4，V4 在 V3 基础上提供受控模块服务接口。
- `module-package-lifecycle`: 安装、升级和激活流程接受并校验 schema V2 / SDK V4 模块。
- `standalone-runtime-module-development`: 独立模板升级到 SDK V4，并模拟模块服务注册与调用。

## Impact

- 基座前端运行时 manifest、Host SDK 类型、SDK 创建与释放链路需要扩展；Rust 仅需接受 SDK V4 清单，不承载同 WebView 内的服务分发。
- `tauri-module-template` 的清单、SDK 类型、模拟宿主、打包校验和文档需要同步升级。
- 三个模块作为基座同级目录下的独立 Git 仓库创建，默认不配置远程仓库，也不纳入基座 Git。
- 本次不建设在线模块市场、远程更新源、跨进程 RPC、任意对象共享或后台常驻服务。
