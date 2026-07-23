# Design: module-dialogs (Host SDK V11)

## 目标

- 让运行时模块能用一个由外壳托管的模态对话框向用户确认或请求输入，避免每模块自绘弹层。
- 保持主题一致、焦点可访问性、键盘可用；模块只拿结果。
- V2–V10 模块行为完全不变。

## 非目标

- 不做真·多原生窗口（独立 OS 窗口）。
- 不承载富 HTML、脚本或任意 DOM 内容。
- 不做文件/目录选择对话框（已有原生 grant 与 `tauri-plugin-dialog`，模块数据导出已用）。
- 不支持无限制嵌套模态；同一模块同时最多一个未关闭对话框。

## 关键决策

### 1. 纯前端能力，不新增原生权限

对话框在主窗口内由外壳渲染一个覆盖层（portal），类似事件总线与服务总线，由前端核心模块管理。无 Rust 命令、无原生能力声明、无权限审批。模块停用随会话清理未关闭对话框。

### 2. 两种对话框类型

- `confirm({ title, message, confirmLabel?, cancelLabel? }): Promise<boolean>` — 返回用户是否确认。
- `prompt({ title, message, defaultValue?, placeholder?, confirmLabel?, cancelLabel? }): Promise<string | null>` — 返回用户输入并确认的文本；取消返回 null。

文案为受限文本（双语 LocalizedText 或字符串）；按钮文案可缺省，外壳提供双语默认值。

### 3. 宿主托管渲染

外壳在应用根节点维护一个 `<ModuleDialogContainer>`，订阅对话框总线。总线暴露 `open(request): Promise<DialogResult>`，按 FIFO 串行处理（同一时刻只显示一个对话框，避免焦点混乱）。模块调用后异步等待结果；模块停用或会话释放时，未关闭的对话框被取消（`confirm→false`、`prompt→null`），容器移除该对话框。

### 4. 内容边界

标题、消息、按钮文案与输入默认值/占位符均为字符串，长度受限（标题 200、消息 2000、按钮 40、输入默认/占位 500）。外壳按主题渲染、提供 Esc 取消、Enter 确认（prompt）。不执行任意 HTML，内容按纯文本转义。

### 5. SDK 形态

V11 模块获得 `sdk.dialogs`：
- `confirm(options): Promise<boolean>`
- `prompt(options): Promise<string | null>`

### 6. 模拟宿主

模板浏览器预览宿主用内存实现 `confirm`/`prompt`（同步回显，不真实模态），保持开发可用。

## 风险与权衡

- 模态对话框会阻塞模块交互流；模块应只在必要时使用，避免频繁打断用户。
- 串行处理避免焦点混乱，但多个模块同时请求会排队等待；用户可见队列长度由总线在界面上提示。
