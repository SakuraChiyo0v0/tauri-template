# Modular Tauri Template

一个保持空业务、但已经准备好主题、基础组件、源码模块和本地运行时模块扩展点的 Tauri 2 桌面应用底座。

## 开始使用

环境需要 Node.js、pnpm、Rust，以及目标平台对应的 Tauri 系统依赖。

```powershell
pnpm install
pnpm tauri dev
```

常用验证命令：

```powershell
pnpm check
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

## 版本与变更记录

底座使用语义化版本，并在 `package.json`、Rust crate、Tauri 配置和 Cargo 锁文件中保持同一个版本。`CHANGELOG.md` 记录每个正式版本对使用者和模块开发者可见的重要变化。

- `patch`：向后兼容的修复；
- `minor`：新增能力；在 `1.0.0` 之前也用于明确的兼容边界变化；
- `major`：进入新的稳定主版本或稳定期后的破坏性变化。

发布时先把 `Unreleased` 内容整理为带日期的新版本条目，再运行：

```powershell
pnpm version:bump patch   # 也可使用 minor、major 或明确版本号
pnpm version:check
pnpm check
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

版本命令只同步文件，不会创建提交、标签、GitHub Release 或推送远端。独立 `.mtp` 模块维护自己的版本，不随底座版本自动变化。

## 设计边界

- `components/ui` 是已配置好的无业务基础组件，可以直接导入。
- `themes` 通过语义 CSS 变量同步所有组件，显示模式与配色预设彼此独立。
- `core` 提供稳定的模块、导航、设置和持久化契约。
- `core/i18n` 统一管理中文与英文；语言选择会持久化，并立即同步到底座、源码模块和运行时模块。
- `features` 保存可从源码添加或移除的功能模块。
- `App` 只渲染模块贡献的侧边栏和页面，不直接依赖具体功能。
- `SettingsPage` 不感知具体模块；模块通过清单贡献设置。
- 运行时模块通过用户主动选择的本地 `.mtp` 包安装；不提供远程下载、插件市场、动态 Rust 或任意原生访问。

## 添加源码模块

模块使用一个清单声明元数据和扩展：

```tsx
export const exampleFeature = defineFeature({
  id: "example",
  name: { "zh-CN": "示例功能", en: "Example feature" },
  description: { "zh-CN": "模块说明", en: "Feature description" },
  version: "0.1.0",
  defaultEnabled: true,
  navigation: [
    {
      id: "example-home",
      title: { "zh-CN": "示例功能", en: "Example feature" },
      description: { "zh-CN": "示例页面说明", en: "Example page description" },
      icon: ExampleIcon,
      component: ExamplePage,
      group: "main",
      order: 20,
    },
  ],
  settings: [
    {
      id: "enabledOption",
      type: "switch",
      group: "features",
      order: 10,
      label: { "zh-CN": "功能选项", en: "Feature option" },
      defaultValue: true,
    },
  ],
});
```

然后仅在 `src/app/module-registry.ts` 注册一次。侧边栏会自动显示已启用模块贡献的页面，设置页会自动按 `group` 和 `order` 显示设置项。停用模块时，这两类扩展都会自动消失。

所有宿主可见模块元数据都必须同时提供 `zh-CN` 和 `en`，缺少任一语言会在类型检查时失败。更完整的 AI 操作步骤位于 `.ai/recipes`。仓库根目录及关键目录中的 `AGENTS.md` 定义了模块边界和验证规则。

## 添加可独立更新的运行时模块

运行时模块在独立的 `tauri-module-template` 工作区开发，不应复制到底座仓库或注册到 `src/app/module-registry.ts`。该模板提供 schema V2 双语清单、Host SDK V3 类型、语言模拟宿主、测试、单文件 ESM 构建和 `.mtp` 打包工具。新底座不再接受 schema V1 或 Host SDK V1 模块包。

Host SDK V2 是当前最低协议，提供语言读取/订阅和模块隔离 SQLite；V3 在此基础上增加原生能力。底座为每个模块创建隔离的 SQLite 数据库，并通过参数化查询、执行、事务和 schema 版本接口访问；模块不能指定数据库路径、附加其他数据库或直接查询其他模块的数据。普通卸载保留数据库，停用模块后可在“模块管理”中显式清理。

模块使用的 npm 库必须打包进 `index.js`；只有对其他已安装 `.mtp` 模块的要求才写入 `manifest.json` 的 `dependencies.required` 或 `dependencies.optional`。必需依赖缺失或版本不兼容时，包仍会保留，但模块会等待而不会执行；可选依赖不会阻止模块启动。依赖仅约束兼容版本与激活顺序，不允许直接导入其他模块源码或调用其内部实现。

### Host SDK V3 原生能力

V3 模块在 `nativeCapabilities` 中声明最小权限。新模块或权限扩大的更新会先安装为“等待权限”，用户在模块管理页查看摘要并批准后才会激活；权限缩小的更新可以复用已有批准。撤销权限会立即使会话失效，并清理模块进程、托盘和快捷键资源。

- 文件：模块私有目录使用相对路径；外部文件、目录和程序只通过用户选择后生成的不透明 grant ID 访问，SDK 不返回真实路径。
- 进程：只可打开清单允许的 URL scheme；`openPath` / `revealInFolder` 只接受本模块的可读文件 grant ID；运行程序也必须使用用户明确授权的可执行文件 grant ID。不提供 Shell、提权、环境继承或无限输出。
- 注册表：Windows 下仅允许清单前缀内的 HKCU 读写与 HKLM 只读；其他平台返回 `unsupported_platform`。
- 托盘与快捷键：模块只声明自己的菜单项和快捷键，由底座统一仲裁、路由和清理。

安全边界针对用户主动安装、可信但可能有缺陷的本地模块。所有模块仍运行在共享 WebView 中，因此 V3 不是恶意 JavaScript 沙箱；不要安装来源不可信的 `.mtp`。Host SDK 不暴露内部 store、原始 `invoke`、任意文件路径或动态 Rust。

```powershell
cd ..\tauri-module-template
pnpm install
pnpm check
pnpm module:pack
```

命令会在独立模块仓库的 `dist` 目录生成 `<module-id>-<version>.mtp`。在 Tauri 应用的“模块管理”中选择该文件即可安装；提高清单版本后可独立升级。回滚、停用和卸载会先检查依赖者，不会静默破坏其他模块。底座不保存第三方模块源码、构建目录或安装产物。完整 AI 开发约束见 `.ai/recipes/add-runtime-module.md`。

## 日志模块

首版日志模块用于验证完整扩展链：

- 前端通过 `logger.trace/debug/info/warn/error` 记录日志；
- Rust 使用标准 `log` 宏；
- Tauri 官方日志插件默认写入终端及系统推荐的应用日志目录；
- 模块向侧边栏注册日志控制台，可筛选、搜索、导出和清空当前会话日志；
- 控制台最多保留最近 1000 条日志，清空不会删除磁盘日志文件；
- 日志级别和控制台同步选项由模块清单注入设置页面；
- 停用模块会停止前端日志，并隐藏其页面和设置贡献。

如果要从源码彻底移除日志模块，还应同时移除：

1. `src/features/logging` 及前端注册项；
2. `src-tauri/src/features/logging.rs` 及 `lib.rs` 注册；
3. `tauri-plugin-log`、`log` 依赖；
4. capability 中的 `log:default`。

## 定制项目身份

复制模板后至少修改：

- `package.json` 的 `name`；
- `src-tauri/Cargo.toml` 的 package/lib 名称；
- `src-tauri/tauri.conf.json` 的 `productName`、窗口标题和唯一 `identifier`；
- `src-tauri/src/main.rs` 引用的库名称；
- 应用图标。

这些属于新项目身份设置，而不是需要清理的演示功能。
