## Why

本地 `.mtp` 已有独立制品目录，但用户仍需逐个打开文件选择器判断和安装包，无法直观看到哪些模块可安装或升级。市场界面本身应保持可拆卸，因此需要让一个独立模块在受控权限下读取用户选择的本地仓库，并由基座执行可信校验和安装。

## What Changes

- 新增独立 `local-module-market` 模块，提供双语市场页面、仓库目录选择、刷新、安装和升级入口。
- **BREAKING**：当前独立模块模板由 Host SDK V4 升级到 V5；已安装的 V2–V4 模块继续兼容运行。
- Host SDK V5 新增受限 `moduleRepository` API。模块只能使用用户选择后生成的不透明目录授权扫描顶层 `.mtp`，不能获得真实路径或读取任意文件。
- 模块清单新增显式的本地模块安装权限。未经安装时批准，模块不能扫描包元数据或安装模块。
- 基座使用现有 `.mtp` 校验器检查仓库包，并从授权目录执行与模块管理页相同的安装、升级和依赖解析流程。
- 市场仓库目录可随时重新选择或撤销；首版不支持网络源、后台自动更新、包上传或发布者签名。

## Capabilities

### New Capabilities

- `local-module-market`: 可拆卸的本地模块市场页面、可自定义仓库目录及可安装/可升级状态。

### Modified Capabilities

- `module-package-lifecycle`: 允许通过获批模块从授权本地仓库安装包，同时复用现有校验、升级、依赖和恢复规则。
- `runtime-module-native-permissions`: 增加需要用户明确批准的本地模块仓库扫描与安装能力。
- `runtime-module-filesystem-access`: 支持模块通过底座目录选择器创建只读、可撤销的仓库目录授权。
- `standalone-runtime-module-development`: 独立模板升级到 Host SDK V5 并提供本地仓库 API 类型和预览模拟。

## Impact

- 基座 TypeScript Host SDK、运行时清单类型、模块加载与测试。
- Rust 清单/权限模型、文件授权、包扫描、安装命令及测试。
- 独立模块模板的 SDK 快照、模拟宿主、清单、文档和测试。
- 新增 `tauri-modules/local-module-market` 本地 Git 模块仓库，并将构建包复制到 `tauri-module-market`。
- Host SDK V2–V4 ABI 和三个现有参考模块保持兼容。
