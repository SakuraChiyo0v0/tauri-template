# Runtime module system V1 verification log

| 检查点 | 是否触发 | 决定或行动 | 证据 |
| --- | --- | --- | --- |
| Brainstorming | 是 | 将底座与可独立更新的本地受信模块拆成版本化 `.mtp` 协议；V1 不含远程商店、签名和动态 Rust | `openspec/changes/runtime-module-system-v1/proposal.md`、`design.md`、两份 capability spec |
| TDD | 是 | 先覆盖清单、包安全、升级/回滚、动态注册、入口激活、Host SDK 和管理操作状态，再写最小实现 | 前端 34 个测试；Rust 12 个常规测试及 1 个真实包冒烟测试 |
| Debugging | 是 | 发现自动回滚可能重新选择已知激活失败版本；增加阻断判断和双版本失败回归测试 | `does_not_auto_restore_a_version_that_already_failed_activation` 通过 |
| Code review | 是 | 对照规格检查贡献冲突、错误隔离、刷新边界、危险 ZIP 路径、内置模块保护和无演示预装 | `git diff --check`、`pnpm check`、`cargo test`、OpenSpec strict validate |
| Verification | 是 | 构建真实 1.0.0/1.1.0 `.mtp`，走正式存储完成安装、重复安装失败不切换、升级、回滚和卸载；Tauri 窗口确认文件选择器可打开 | `runs_the_real_package_lifecycle_smoke` 通过；真实 Tauri 管理页冒烟 |
