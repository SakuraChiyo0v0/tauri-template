## Why

底座和现有模块的用户界面文案目前直接写死为中文，语言切换无法同步到侧边栏、设置、日志和运行时模块。项目仍处于协议早期，适合现在建立强制双语的新基线，避免后续模块各自补丁式接入国际化。

## What Changes

- 新增底座级中文（`zh-CN`）与英文（`en`）语言状态、持久化设置和即时切换能力。
- 底座外壳、系统模块、日志模块、模块管理、设置和主题控件的用户可见文案全部改由类型化词典提供。
- 源码模块的名称、说明、导航和设置贡献必须同时提供中文与英文。
- **BREAKING**：运行时模块清单升级为 schema V2，所有宿主渲染的模块元数据必须同时提供中文与英文；schema V1 包不再安装或加载。
- **BREAKING**：移除 Host SDK V1，保留 Host SDK V2 与 V3，并为两者增加当前语言读取与订阅接口；旧 V1 模块不再支持。
- 独立模块模板升级为双语 schema V2 / SDK V3，模块页面示例跟随底座语言变化，并在检查和打包时拒绝缺失任一语言。

## Capabilities

### New Capabilities

- `application-localization`: 定义底座支持的语言、默认值、持久化、界面切换和源码模块双语约束。

### Modified Capabilities

- `runtime-module-contributions`: 运行时模块清单、宿主贡献和 Host SDK 改为强制双语的新基线。
- `module-package-lifecycle`: 安装校验只接受 schema V2 与 Host SDK V2/V3 模块，不再保留旧协议兼容路径。
- `standalone-runtime-module-development`: 独立模块模板必须提供双语清单、语言模拟器和双语模块页面验证。

## Impact

- 前端新增 i18n 核心，并调整应用外壳、主题、设置、内置模块和运行时模块加载链路。
- TypeScript 与 Rust 运行时清单结构和校验发生破坏性变化，现有 schema V1 / SDK V1 `.mtp` 包需要重新构建。
- Host SDK V2 公共类型增加语言状态接口，Host SDK V3 继承该接口；模块页面应订阅语言变化后重新渲染。
- 独立 `tauri-module-template` 仓库需要同步新协议、测试、预览和文档。
- 已归档的 `runtime-module-native-capabilities-v1` 主规格继续有效，现有 SDK V3 改为继承 schema V2 / SDK V2 的双语基线。
