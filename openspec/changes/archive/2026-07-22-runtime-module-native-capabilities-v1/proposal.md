## Why

运行时模块目前只能使用日志、设置、主题以及正在另一个变更中建设的隔离数据库，无法完成桌面工具常见的文件处理、程序启动、Windows 注册表读取、托盘菜单和全局快捷键。底座需要提供受控、可说明、可撤销的原生能力代理，让模块获得实用系统能力，同时避免暴露原始 Tauri invoke、任意 Shell 和无边界系统访问。

## What Changes

- 在 SQLite Host SDK V2 之上新增 Host SDK V3，并保持 V1/V2 模块兼容。
- 模块清单可以声明原生能力及最小访问范围；安装和新增权限升级时向用户展示并要求明确授权。
- 文件系统支持模块私有目录以及用户通过选择器授予的外部文件或目录授权，不接受任意路径访问。
- 进程能力支持打开 URL/文件、在文件管理器中定位，以及运行用户选择并授权的可执行文件；禁止 Shell 字符串、提权和任意环境继承。
- Windows 注册表支持声明范围内的 HKCU 读写和 HKLM 只读；其他平台返回结构化“不支持”结果。
- 托盘由底座统一持有，模块仅贡献自己的菜单分组并接收本模块菜单事件。
- 全局快捷键由底座统一注册、检测冲突、随模块停用注销，并允许用户禁用或重新绑定。
- 权限可在模块管理界面查看和撤销；撤销、停用、卸载或激活失败必须立即释放运行中的原生资源。

## Capabilities

### New Capabilities

- `runtime-module-native-permissions`: 定义原生能力声明、安装授权、权限升级、撤销和运行时校验。
- `runtime-module-filesystem-access`: 定义模块私有文件、用户选择授权、受限读写与目录操作。
- `runtime-module-process-access`: 定义 URL/文件打开、文件定位和用户授权可执行文件的受控启动。
- `runtime-module-registry-access`: 定义 Windows 注册表范围、平台差异以及读写限制。
- `runtime-module-tray-contributions`: 定义模块托盘菜单贡献、事件隔离和生命周期清理。
- `runtime-module-global-shortcuts`: 定义快捷键注册、冲突处理、用户覆盖和生命周期清理。

### Modified Capabilities

- `runtime-module-contributions`: 增加 Host SDK V3 协商和原生能力接口，同时保留 V1/V2 运行语义。
- `module-package-lifecycle`: 安装、升级、停用和卸载流程增加权限审查、授权保留及运行资源清理。

## Impact

- Rust 底座新增统一原生能力代理，以及文件、进程、Windows 注册表、托盘和快捷键实现。
- 模块清单解析、安装状态、Tauri 命令、前端 Host SDK 类型和模块加载器需要支持权限声明与 V3 协商。
- 模块管理界面增加权限摘要、授权、撤销和快捷键冲突处理。
- Tauri/Cargo 依赖和应用能力配置将增加必要的桌面插件或平台依赖，但模块仍不能调用原始插件 API。
- 独立模块模板需要在 SQLite V2 变更完成后升级到 V3 类型和原生能力开发模拟器。
- 本变更不允许动态 Rust/DLL、管理员提权、任意 Shell、后台服务或未经用户授权的新权限。
