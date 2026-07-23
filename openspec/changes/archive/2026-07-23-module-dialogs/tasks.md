# Tasks: module-dialogs (Host SDK V11)

## 1. 锁定协议与失败行为（红灯）

- [x] 1.1 为 Rust 清单增加红灯测试：接受 SDK V11；V2–V10 行为不变
- [x] 1.2 为 TypeScript 清单解析增加红灯测试：SDK V11 接受
- [x] 1.3 为对话框总线增加红灯测试：串行显示、内容边界与截断、Esc/Enter、生命周期取消与释放后拒绝

## 2. 实现基座对话框

- [x] 2.1 扩展 Rust 清单 `MAX_SDK_VERSION` 到 11 与 TS `RUNTIME_MODULE_SDK_VERSION` 11，使 1.1/1.2 转绿
- [x] 2.2 实现 `runtime-module-dialogs.ts` 对话框总线（请求队列、串行处理、内容校验截断、生命周期取消），使 1.3 转绿
- [x] 2.3 在外壳渲染 `<ModuleDialogContainer>` 订阅总线；接入 `runtime-module-sdk.ts` 的 `sdk.dialogs.confirm/prompt`（仅 V11）并在释放路径取消
- [x] 2.4 扩展 `runtime-module-types.ts` 的 V11 类型

## 3. 更新独立模块开发体验

- [x] 3.1 更新 `tauri-module-template` 的 V11 SDK 类型、README 与 AGENTS
- [x] 3.2 扩展模板模拟宿主：模拟 confirm/prompt 往返
- [x] 3.3 为模板对话框 API、模拟宿主与确定性打包增加关键测试，运行模板 `pnpm check`

## 4. 集成验证与规格收尾

- [x] 4.1 运行基座 `pnpm check`、`cargo test` 与 `cargo check --manifest-path src-tauri/Cargo.toml`
- [x] 4.2 静态审查：对话框不执行任意 HTML、不绕过外壳托管、不向 V2–V10 注入能力
- [x] 4.3 更新 README、`.ai/recipes`、CHANGELOG（Unreleased），运行 `openspec validate module-dialogs --strict`
