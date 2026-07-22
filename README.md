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

## 设计边界

- `components/ui` 是已配置好的无业务基础组件，可以直接导入。
- `themes` 通过语义 CSS 变量同步所有组件，显示模式与配色预设彼此独立。
- `core` 提供稳定的模块、导航、设置和持久化契约。
- `features` 保存可从源码添加或移除的功能模块。
- `App` 只渲染模块贡献的侧边栏和页面，不直接依赖具体功能。
- `SettingsPage` 不感知具体模块；模块通过清单贡献设置。
- 运行时模块通过用户主动选择的本地 `.mtp` 包安装；首版不提供远程下载、插件市场、动态 Rust 或额外系统权限。

## 添加源码模块

模块使用一个清单声明元数据和扩展：

```tsx
export const exampleFeature = defineFeature({
  id: "example",
  name: "示例功能",
  description: "模块说明",
  version: "0.1.0",
  defaultEnabled: true,
  navigation: [
    {
      id: "example-home",
      title: "示例功能",
      description: "示例页面说明",
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
      label: "功能选项",
      defaultValue: true,
    },
  ],
});
```

然后仅在 `src/app/module-registry.ts` 注册一次。侧边栏会自动显示已启用模块贡献的页面，设置页会自动按 `group` 和 `order` 显示设置项。停用模块时，这两类扩展都会自动消失。

更完整的 AI 操作步骤位于 `.ai/recipes`。仓库根目录及关键目录中的 `AGENTS.md` 定义了模块边界和验证规则。

## 添加可独立更新的运行时模块

`examples/minimal-runtime-module` 是一个不会预装到底座的最小模块源码。它通过清单注册侧边栏页面和基础设置，通过单文件 ESM 入口定义 Web Component，并使用带版本的 Host SDK 访问日志、模块私有设置和主题状态。

```powershell
pnpm module:pack
```

命令会生成 `examples/minimal-runtime-module/dist/example-greeting-1.0.0.mtp`。在 Tauri 应用的“模块管理”中选择该文件即可安装；提高清单版本后可独立升级，并可从管理页回滚或卸载。完整 AI 开发约束见 `.ai/recipes/add-runtime-module.md`。

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
