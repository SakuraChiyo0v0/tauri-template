# Tasks: module-data-portability (Host SDK V9)

## 1. 锁定协议与失败行为（红灯）

- [x] 1.1 为 Rust 清单与权限增加红灯测试：接受 SDK V9；V2–V8 行为不变
- [x] 1.2 为 TypeScript 清单解析增加红灯测试：SDK V9 接受
- [x] 1.3 为数据迁移增加红灯测试：导出经 grant、用户取消返回 null、导入归属/格式校验、活动时拒绝、释放后失效

## 2. 实现基座数据迁移

- [x] 2.1 扩展 Rust 清单 `MAX_SDK_VERSION` 到 9 与 TS `RUNTIME_MODULE_SDK_VERSION` 9，使 1.1/1.2 转绿
- [x] 2.2 新增 `src-tauri` `data_portability.rs`：归档格式（头部 JSON + SQLite 字节）、保存/打开对话框、归属与格式校验、导入运行中拒绝与停用后覆盖；注册命令
- [x] 2.3 扩展 `runtime-module-native-api.ts` 与 `runtime-module-sdk.ts` 接入 `sdk.data.exportBackup/importBackup`（仅 V9），使 1.3 转绿
- [x] 2.4 扩展 `runtime-module-types.ts` 的 V9 类型

## 3. 更新独立模块开发体验

- [x] 3.1 更新 `tauri-module-template` 的 V9 SDK 类型、README 与 AGENTS
- [x] 3.2 扩展模板模拟宿主：模拟数据导出/导入往返
- [x] 3.3 为模板数据 API、模拟宿主与确定性打包增加关键测试，运行模板 `pnpm check`

## 4. 集成验证与规格收尾

- [x] 4.1 运行基座 `pnpm check`、`cargo test` 与 `cargo check --manifest-path src-tauri/Cargo.toml`
- [x] 4.2 静态审查：迁移不泄露路径、不跨模块、不绕过校验、不向 V2–V8 注入能力
- [x] 4.3 更新 README、`.ai/recipes`、CHANGELOG（Unreleased），运行 `openspec validate module-data-portability --strict`
