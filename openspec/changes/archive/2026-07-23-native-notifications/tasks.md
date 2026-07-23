# Tasks: native-notifications (Host SDK V8)

## 1. 锁定协议与失败行为（红灯）

- [x] 1.1 为 Rust 清单与权限结构增加红灯测试：接受 SDK V8 与 `notifications` 能力声明、指纹/摘要含通知、V2–V7 声明通知被拒、未批准发送被拒
- [x] 1.2 为 TypeScript 清单解析增加红灯测试：SDK V8、`notifications` 能力解析与非法声明拒绝
- [x] 1.3 为通知 SDK 与原生后端增加红灯测试：内容校验、截断、未批准/释放后拒绝发送

## 2. 实现基座通知能力

- [x] 2.1 扩展 Rust `NativeCapabilities` 增加 `notifications`（`{ system: bool }`）、摘要变体、`has_kind`、`is_subset_of`、`normalize`；扩展清单 `MAX_SDK_VERSION` 到 8 与校验，使 1.1 转绿
- [x] 2.2 新增 `src-tauri` `notifications.rs` 原生能力模块（`tauri-plugin-notification`），注册插件、capability 与命令；会话令牌权限校验后发送系统通知
- [x] 2.3 扩展 `runtime-module-native-api.ts` 后端接口与 `runtime-manifest.ts` 接受 V8 与 `notifications`；实现 `runtime-module-sdk.ts` 接入 `sdk.notifications.show`（仅 V8）并在释放路径失效，使 1.2/1.3 转绿
- [x] 2.4 扩展 `runtime-module-types.ts` 的 V8 类型与 `NativePermissionSummary` TS 对应

## 3. 更新独立模块开发体验

- [x] 3.1 更新 `tauri-module-template` 的 V8 SDK 类型、双语清单 `notifications` 示例与 README
- [x] 3.2 扩展模板模拟宿主：模拟通知发送（记录意图并回显，不真实推送）
- [x] 3.3 为模板通知 API、模拟宿主与确定性打包增加关键测试，运行模板 `pnpm check`

## 4. 集成验证与规格收尾

- [x] 4.1 运行基座 `pnpm check`、`cargo test` 与 `cargo check --manifest-path src-tauri/Cargo.toml`
- [x] 4.2 静态审查：通知不绕过权限、不泄露机密、不向 V2–V7 注入能力
- [x] 4.3 更新 README、`.ai/recipes`、CHANGELOG（Unreleased），运行 `openspec validate native-notifications --strict`
