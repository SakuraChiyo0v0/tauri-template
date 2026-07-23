# Design: native-notifications (Host SDK V8)

## 目标

- 让获批的运行时模块能向操作系统发起系统通知，覆盖模块不在前台时的提醒需求。
- 作为 V3 原生能力家族的新成员，复用既有权限模型，不引入第二种审批流程。
- V2–V7 模块行为完全不变。

## 非目标

- 不做应用内 Toast 浮层（需要外壳覆盖层与动画，留给后续能力）。
- 不做通知点击回调、操作按钮、声音或振动定制。
- 不做通知持久化或历史；通知发出后由操作系统处理。
- 不做联网推送或远程通知。

## 关键决策

### 1. 复用 V3 原生能力审批流程

通知能力加入 `NativeCapabilities.notifications`，与 filesystem/process/registry/tray/shortcuts/moduleRepository 并列。指纹、摘要、`has_kind`、`is_subset_of`、`PermissionStore` 全部复用，新成员只需在各处加一个分支。权限扩大的更新走既有“等待权限”流程，撤销走既有清理流程。

决策依据：审批流程已稳定且有测试覆盖，新增一类原生能力不应另起炉灶。

### 2. 能力声明形态

`notifications` 能力是布尔开关：声明即请求系统通知权限，不声明即无权。形式：`nativeCapabilities.notifications: { system: true } | null`。预留 `system` 子键以便未来区分“系统通知”与“应用内 Toast”时不必破坏清单结构（应用内 Toast 为非目标，本次不实现）。

### 3. 通知内容边界

`sdk.notifications.show({ title, body })`：title 与 body 为字符串，底座按 200 / 500 字符截断并校验为非控制字符纯文本。底座不附加模块数据库内容或机密；模块负责提供可展示文本。投递失败（例如系统拒绝）返回错误，模块应记录为 `warn` 而非崩溃。

### 4. 后端实现

使用 `tauri-plugin-notification` 在 Rust 侧发起系统通知。新增 `notifications.rs` 模块，注册插件到 `lib.rs`，添加 capability 条目。原生后端按会话令牌校验权限后调用插件发送。会话释放时该模块的通知能力随会话失效（不撤销已发出的通知，那是操作系统职责）。

### 5. SDK 形态

V8 模块获得 `sdk.notifications`：
- `show(options: { title: string; body?: string }): Promise<void>` — 校验内容并请求系统通知，失败抛错。

### 6. 权限边界

通知能力与其他原生能力一样针对“可信但可能有缺陷”的模块。模块不能伪造来源或绕过审批；未批准时调用返回权限错误。不提供静默、强制置顶或绕过系统勿扰的能力。

## 风险与权衡

- 新增 `tauri-plugin-notification` 依赖会拉取额外 crate；接受这一基础设施成本以获得原生通知。
- 系统通知在不同平台表现不同（Windows 通知中心、macOS 通知中心、Linux libnotify）；底座依赖插件跨平台行为，不在规格中固化平台差异。
- 通知可能被用户在操作系统层面禁用；此时 `show()` 失败，模块应优雅降级（记 warn）。
