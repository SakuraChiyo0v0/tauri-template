# Tasks: module-event-bus (Host SDK V7)

## 1. 锁定协议与失败行为（红灯）

- [x] 1.1 为 Rust 清单解析增加红灯测试：接受 SDK V7 与合法 `events` 声明，拒绝 V2–V6 声明事件、重复与非法事件 ID；V2–V6 行为不变
- [x] 1.2 为 Rust 数据库命令版本检查增加红灯测试：V6 模块调用数据库命令被拒绝（确认 bug），修复后 V6/V7 可用且 V2–V5 回归不变
- [x] 1.3 为 TypeScript 清单解析增加红灯测试：SDK V7、`events.publishes`/`subscribes` 解析与非法声明拒绝
- [x] 1.4 为事件总线增加红灯测试：发布授权、订阅匹配、载荷边界、信封身份、异常隔离、顺序与生命周期清理

## 2. 实现基座事件总线

- [x] 2.1 扩展 Rust 清单解析（`MAX_SDK_VERSION` 7、`events` 字段校验）并修正数据库命令版本范围为 MIN–MAX，使 1.1/1.2 转绿
- [x] 2.2 扩展 TypeScript 清单解析与 SDK 常量接受 V7 和 `events` 声明，使 1.3 转绿
- [x] 2.3 实现 `runtime-module-events.ts` 事件总线（声明校验、信封构造、深复制、异步投递、异常隔离、按会话退订），使 1.4 转绿
- [x] 2.4 在 `runtime-module-sdk.ts` 接入 `sdk.events`（仅 V7）并在释放路径自动退订；扩展 `runtime-module-types.ts` 的 V7 类型
- [x] 2.5 增加 SDK 构建/释放测试：V7 模块获得事件 API、V6 模块不注入事件能力、释放后发布与监听失效

## 3. 更新独立模块开发体验

- [x] 3.1 更新 `tauri-module-template` 的 V7 SDK 类型、双语清单 `events` 示例与 README，保留选择旧 SDK 版本的说明
- [x] 3.2 扩展模板模拟宿主：按清单声明模拟事件发布/订阅、信封注入与未声明拒绝
- [x] 3.3 为模板事件 API、模拟宿主与确定性打包增加关键测试，运行模板 `pnpm check`

## 4. 升级参考模块

- [x] 4.1 `local-notes` 升级 SDK V7：清单声明 `notes.changed.v1`，便签增删改成功后发布摘要事件，失败不发布；补关键测试并升级模块版本
- [x] 4.2 `notes-dashboard` 升级 SDK V7：清单声明订阅，收到事件后自动经 `notes.v1` 刷新并保留手动刷新；补关键测试并升级模块版本
- [x] 4.3 两个模块各自 `pnpm check` 与 `pnpm module:pack`，新 `.mtp` 复制到 `tauri-module-market`

## 5. 集成验证与规格收尾

- [x] 5.1 运行基座 `pnpm check`、`cargo test` 相关套件和 `cargo check --manifest-path src-tauri/Cargo.toml`
- [x] 5.2 静态审查：确认事件边界不泄露引用、不伪造发布者、不向 V2–V6 注入能力、不记录载荷内容
- [x] 5.3 手动冒烟：安装新版 `local-notes` 与 `notes-dashboard`，修改便签后面板自动刷新；停用面板后修改便签再启用，显示正常（注：真实 GUI 安装路径无法在无头环境执行；行为已由模块级事件发布/订阅测试与 SDK 释放测试覆盖，最终 GUI 冒烟待用户在桌面底座执行）
- [x] 5.4 更新 README、`.ai/recipes` 模块开发提示、CHANGELOG（Unreleased），运行 `openspec validate module-event-bus --strict`
