# Tasks: http-proxy (Host SDK V12)

## 1. 锁定协议与失败行为（红灯）

- [x] 1.1 为 Rust 清单与权限结构增加红灯测试：接受 SDK V12 与 `http` 能力声明、指纹/摘要含 HTTP、非 https 源/低版本被拒、未批准请求被拒
- [x] 1.2 为 TypeScript 清单解析增加红灯测试：SDK V12、`http` 能力解析与非法声明拒绝
- [x] 1.3 为 HTTP 代理后端增加红灯测试：源校验、私有地址拒绝、方法/大小/超时边界、释放后拒绝

## 2. 实现基座 HTTP 代理能力

- [x] 2.1 扩展 Rust `NativeCapabilities` 增加 `http`（`{ origins: Vec<String> }`）、摘要变体、`has_kind`、`is_subset_of`、`normalize`（https 校验、去重排序）；扩展清单 `MAX_SDK_VERSION` 到 12 与校验，使 1.1 转绿
- [x] 2.2 新增 `src-tauri` `http_proxy.rs`（`reqwest`），注册命令；会话令牌权限校验、源与私有地址校验、方法/大小/超时边界、不持久 cookie、不跨源重定向
- [x] 2.3 扩展 `runtime-module-native-api.ts` 与 `runtime-manifest.ts` 接受 V12 与 `http`；实现 `runtime-module-sdk.ts` 接入 `sdk.http.fetch`（仅 V12），使 1.2/1.3 转绿
- [x] 2.4 扩展 `runtime-module-types.ts` 的 V12 类型与 `NativePermissionSummary` TS 对应

## 3. 更新独立模块开发体验

- [x] 3.1 更新 `tauri-module-template` 的 V12 SDK 类型、双语清单 `http` 示例与 README、AGENTS
- [x] 3.2 扩展模板模拟宿主：模拟 HTTP fetch 固定回显
- [x] 3.3 为模板 HTTP API、模拟宿主与确定性打包增加关键测试，运行模板 `pnpm check`

## 4. 集成验证与规格收尾

- [x] 4.1 运行基座 `pnpm check`、`cargo test` 与 `cargo check --manifest-path src-tauri/Cargo.toml`
- [x] 4.2 静态审查：HTTP 不绕过权限、不访问私有地址、不向 V2–V11 注入能力
- [x] 4.3 更新 README、`.ai/recipes`、CHANGELOG（Unreleased），运行 `openspec validate http-proxy --strict`
