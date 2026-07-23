# Design: clipboard-access (Host SDK V10)

## 目标

- 让获批的运行时模块能读写系统剪贴板纯文本。
- 作为 V3 原生能力家族新成员，复用既有权限模型。
- V2–V9 模块行为完全不变。

## 非目标

- 不做富文本、HTML、图像或文件剪贴板格式。
- 不做剪贴板内容变更监听或后台静默读取。
- 不做跨进程剪贴板同步或历史记录。

## 关键决策

### 1. 复用 V3 原生能力审批流程

`clipboard` 能力加入 `NativeCapabilities.clipboard`，与现有能力并列。指纹、摘要、`has_kind`、`is_subset_of`、`PermissionStore` 全部复用。

### 2. 能力声明形态

`clipboard: { text: true } | null`。预留 `text` 子键以便未来区分文本与其他格式（图像等），本次只实现文本。

### 3. 内容边界

`writeText(text)` 接受有限长度（如 1MB）纯文本，底座截断并校验非控制字符滥用（允许换行等常规字符）。`readText()` 返回剪贴板当前纯文本或空串。不读取/写入富文本或文件。

### 4. 后端实现

使用 `tauri-plugin-clipboard-manager` 在 Rust 侧读写剪贴板。新增 `clipboard.rs` 模块，命令按会话令牌权限校验后调用插件。

### 5. SDK 形态

V10 模块获得 `sdk.clipboard`：
- `readText(): Promise<string>`
- `writeText(text: string): Promise<void>`

### 6. 权限边界

剪贴板能力与其他原生能力一样针对可信模块。未批准时调用返回权限错误；不提供静默监听或后台读取。

## 风险与权衡

- 新增 `tauri-plugin-clipboard-manager` 依赖；接受该成本以获得原生剪贴板。
- 读取剪贴板可能获得用户复制的敏感内容（密码等）；模块只读不记日志，且能力需用户显式批准。规格禁止把读取内容写入模块日志。
