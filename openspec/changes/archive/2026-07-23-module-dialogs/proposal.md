## Why

运行时模块经常需要向用户确认操作或提示输入，例如删除便签前确认、重命名前输入新名称。目前模块只能在页面里自绘弹层，样式、可访问性与焦点管理不一致；模块也没有一个标准、宿主托管的模态对话框入口，导致每模块自行实现、体验割裂。

## What Changes

- 新增 Host SDK V11 模块对话框能力：模块通过 `sdk.dialogs.confirm(options)` 请求一个由外壳托管的模态确认对话框，通过 `sdk.dialogs.prompt(options)` 请求模态文本输入。外壳负责渲染、焦点陷阱、键盘（Esc 关闭、Enter 提交）与主题样式；模块只收到结果。
- 对话框是纯前端能力，不新增原生权限、不新增 Rust 命令；由外壳在主窗口内渲染一个覆盖层，模块通过 Host SDK 异步等待结果。
- 对话框内容为受限文本（标题、消息、按钮文案双语可选、输入默认值与占位符）；不承载富 HTML、脚本或任意 DOM。模块停用时未关闭的对话框随会话清理。
- Host SDK V11 = V10 全部能力 + `dialogs` 命名空间；V2–V10 模块行为完全不变。

## Capabilities

### New Capabilities

- `runtime-module-dialogs`: SDK V11 模块模态对话框的调用边界、内容约束、宿主托管渲染与生命周期清理。

### Modified Capabilities

- `standalone-runtime-module-development`: 模板 Host SDK 类型与模拟宿主从 V10 描述更新到 V11，新增对话框模拟预览。

## Impact

- 基座前端：`src/core/runtime-modules` 新增对话框总线与外壳渲染容器，SDK 构建接入 `sdk.dialogs`，释放路径清理。
- 基座原生：仅 `MAX_SDK_VERSION` 提升到 11，无新原生命令或权限。
- 独立仓库：`tauri-module-template`（SDK 类型、清单示例、模拟宿主、测试）。
- 非目标：真·多原生窗口、自定义任意 DOM/HTML 内容、文件选择对话框（已有原生 grant 机制）与无限制嵌套模态均不在本次范围。
