## Context

当前底座包含 `examples/minimal-runtime-module` 和仓库级打包脚本。它们可以证明包协议，但模块开发仍然依赖底座目录结构，且缺少 TypeScript Host SDK 类型、独立测试和浏览器预览。与此同时，底座已经承诺不预装演示业务，继续把模块源码放在底座仓库会模糊源码模块与用户安装模块的边界。

本变更跨两个本地 Git 工作区：底座记录协议、真实集成验证和迁移说明；相邻的模块模板仓库提供开发工具。两者不通过源码相对路径耦合，只通过 `.mtp` schemaVersion 1 和 Host SDK V1 交互。

## Goals / Non-Goals

**Goals:**

- 新模块仓库克隆后可以独立安装依赖、预览、测试、构建和打包。
- 模板包含与 Host SDK V1 对齐的公开类型，但不暴露底座内部注册表或 Tauri invoke。
- 打包结果是底座能够安装的确定性 `.mtp`，包含 `manifest.json`、单文件 `index.js` 和可选 assets。
- 用两个真实版本验证底座安装、升级、回滚和卸载。
- 底座不再保存运行时模块示例源码和模块专用打包实现。

**Non-Goals:**

- 不发布 npm 包、GitHub Template 或远程仓库。
- 不提供 React 运行时、模块商店、签名或自动下载。
- 不新增文件、网络、进程等原生 Host SDK 权限。
- 不实现模块间服务注册和调用。

## Decisions

### 独立仓库使用 TypeScript、Vite 和 Vitest

Vite library mode 将模块入口及 npm 依赖打包为单文件 ESM `index.js`；Vitest 验证 `activate(hostSdk)`、自定义元素注册和设置/主题响应；开发入口使用模拟 Host SDK 在普通浏览器中预览。选择与底座相同的工具栈可以降低维护成本，但模板不导入底座源码。

备选的纯 JavaScript 模板依赖更少，但无法在开发期检查 Host SDK 契约，容易把错误推迟到安装后。

### Host SDK 类型随模板版本化

模板仓库保存公开的 V1 类型快照，并在 `RuntimeModuleHostSdk.sdkVersion` 上固定字面量 `1`。底座仍是运行时实现的来源；真实包冒烟用于发现类型快照和运行时的漂移。未来需要共享发布包时再提取 `@modular-tauri/sdk`，首版不引入包发布流程。

### 模板入口采用原生 Web Component

运行时页面协议本身要求自定义元素。模板直接提供业务中立的 Web Component，不强制 React 或其他框架；开发者仍可把框架依赖打进单文件入口。

### 打包工具保留在模块仓库

模块仓库的 `scripts/pack.mjs` 校验 manifest、入口和资源路径，然后生成确定性 ZIP。它接受明确版本覆盖，以便在不修改源码的情况下生成升级冒烟所需的两个包。底座只消费 `.mtp`，不再负责构建第三方模块。

### 真实包测试复用 Rust 手动冒烟入口

底座的 ignored 测试改为使用当前 crate 版本作为 host version，并通过 `MTP_SMOKE_V1`、`MTP_SMOKE_V2` 接收独立仓库产物。验证命令显式运行该测试，避免普通单元测试依赖相邻工作区。

## Risks / Trade-offs

- [SDK 类型快照可能漂移] → 固定 `sdkVersion`，加入真实包集成冒烟；Host SDK 变化必须同步更新模板。
- [相邻目录不是远程可复现依赖] → 两个仓库完全独立安装；底座验证通过环境变量接收包路径，不硬编码相邻目录。
- [开发预览与真实 Tauri 环境不同] → 模拟宿主只用于快速 UI 开发，最终验收必须安装真实 `.mtp`。
- [移除底座示例降低单仓库即用性] → README 明确独立模板位置和协议，底座保留完整运行时测试。

## Migration Plan

1. 创建并验证独立模块模板仓库。
2. 使用模板生成 `0.1.0` 与 `0.1.1` 包，通过底座真实生命周期冒烟。
3. 更新底座文档和测试后，删除原示例目录与打包脚本。
4. 若验证失败，保留独立仓库用于调试，底座示例删除在修复完成前不提交。

## Open Questions

- 远程仓库名称、是否启用 GitHub Template、是否发布独立 SDK npm 包留到本地体验验证后决定。
