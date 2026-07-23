## Why

运行时模块目前只能通过日志或页面更新提醒用户；当模块不在前台或应用被最小化时（例如定时任务完成、后台同步出错），用户无法及时收到通知。模块需要一个受控、可审批的方式向操作系统发起系统级通知，让用户像收到普通应用通知一样看到模块事件。

## What Changes

- 新增 Host SDK V8 模块系统通知能力：模块在清单 `nativeCapabilities.notifications` 中声明该能力（经用户审批），再通过 `sdk.notifications.show({ title, body })` 请求系统通知。
- 通知能力作为 V3 原生能力家族的新成员，复用既有权限审批、指纹、摘要、撤销与生命周期清理流程；权限扩大的更新会先安装为“等待权限”，用户在模块管理页批准后才激活。
- 通知内容受限：标题与正文为有限长度的纯文本，由底座截断与校验；底座不自动附带模块机密数据或数据库内容。模块负责在调用前对内容做基本校验。
- Host SDK V8 = V7 全部能力 + `notifications` 命名空间；V2–V7 模块行为完全不变，不声明通知能力的 V8 服务模块不需要空审批。
- 同步升级独立模块模板（SDK 类型、清单示例、模拟宿主通知支持）。

## Capabilities

### New Capabilities

- `runtime-module-notifications`: SDK V8 模块系统通知的清单声明、权限审批、内容边界与生命周期清理。

### Modified Capabilities

- `standalone-runtime-module-development`: 模板 Host SDK 类型与模拟宿主从 V7 描述更新到 V8，新增通知模拟预览。

## Impact

- 基座原生：`src-tauri` 新增 `notifications.rs` 原生能力模块（基于 `tauri-plugin-notification`），扩展 `NativeCapabilities` 结构与摘要、指纹、审批流程。
- 基座前端：`src/core/runtime-modules` 清单解析接受 SDK V8 与 `notifications` 能力，SDK 构建接入 `sdk.notifications`，释放路径清理。
- 独立仓库：`tauri-module-template`（SDK 类型、清单示例、模拟宿主、测试）。
- 不影响：事件总线、模块服务、模块包生命周期、依赖求解；不引入联网、任意弹窗或绕过权限的系统调用。
- 非目标：应用内 Toast 浮层、声音/振动定制、通知点击回调路由与通知持久化不在本次范围；可后续作为独立能力扩展。
