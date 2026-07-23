## Why

运行时模块经常需要与系统剪贴板交互（例如便签模块复制便签内容、工具模块把生成的标识符写入剪贴板）。目前模块没有受控的剪贴板访问途径，只能通过 DOM 的 `navigator.clipboard`，该方式在 WebView 中受跨域与权限策略限制，也不经过模块权限审批。

## What Changes

- 新增 Host SDK V10 模块剪贴板能力：模块在清单 `nativeCapabilities.clipboard` 中声明 `text: true`（经用户审批），再通过 `sdk.clipboard.readText()` / `writeText(text)` 读写系统剪贴板纯文本。
- 作为 V3 原生能力家族的新成员，复用既有权限审批、指纹、摘要、撤销与生命周期清理流程。
- 限制为纯文本读写；不提供富文本、图像、监控或后台静默监听。读取或写入都需模块当前获批且有活动会话。
- Host SDK V10 = V9 全部能力 + `clipboard` 命名空间；V2–V9 模块行为完全不变。

## Capabilities

### New Capabilities

- `runtime-module-clipboard-access`: SDK V10 模块剪贴板文本读写的清单声明、权限审批、内容边界与生命周期清理。

### Modified Capabilities

- `standalone-runtime-module-development`: 模板 Host SDK 类型与模拟宿主从 V9 描述更新到 V10，新增剪贴板模拟预览。

## Impact

- 基座原生：扩展 `NativeCapabilities` 增加 `clipboard`，新增剪贴板代理（基于 `tauri-plugin-clipboard-manager`），注册命令。
- 基座前端：清单解析接受 SDK V10 与 `clipboard` 能力，SDK 构建接入 `sdk.clipboard`。
- 独立仓库：`tauri-module-template`（SDK 类型、清单示例、模拟宿主、测试）。
- 非目标：富文本、图像、文件剪贴板格式、剪贴板内容变更监听、后台静默读取均不在本次范围。
