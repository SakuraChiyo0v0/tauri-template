# Runtime module system V1 verification log

| 检查点 | 是否触发 | 决定或行动 | 证据 |
| --- | --- | --- | --- |
| Brainstorming | 是 | 将底座与可独立更新的本地受信模块拆成版本化 `.mtp` 协议；V1 不含远程商店、签名和动态 Rust | `openspec/changes/runtime-module-system-v1/proposal.md`、`design.md`、两份 capability spec |
| TDD | 是 | 先覆盖清单、包安全、升级/回滚、动态注册、入口激活、Host SDK 和管理操作状态，再写最小实现 | 前端 34 个测试；Rust 12 个常规测试及 1 个真实包冒烟测试 |
| Debugging | 是 | 发现自动回滚可能重新选择已知激活失败版本；增加阻断判断和双版本失败回归测试 | `does_not_auto_restore_a_version_that_already_failed_activation` 通过 |
| Code review | 是 | 对照规格检查贡献冲突、错误隔离、刷新边界、危险 ZIP 路径、内置模块保护和无演示预装 | `git diff --check`、`pnpm check`、`cargo test`、OpenSpec strict validate |
| Verification | 是 | 构建真实 1.0.0/1.1.0 `.mtp`，走正式存储完成安装、重复安装失败不切换、升级、回滚和卸载；Tauri 窗口确认文件选择器可打开 | `runs_the_real_package_lifecycle_smoke` 通过；真实 Tauri 管理页冒烟 |

## Runtime module dependency graph

| 检查点 | 是否触发 | 决定或行动 | 证据 |
| --- | --- | --- | --- |
| Brainstorming | 是 | 将包落盘与全局激活计划分离；必需依赖阻塞、可选依赖仅排序；不加入远程下载、静默级联或跨模块服务 API | `openspec/changes/runtime-module-dependency-graph/proposal.md`、`design.md`、三份 capability spec |
| TDD | 是 | 先覆盖清单兼容、确定性有限回溯、循环与拓扑、计划原子写入、V1 迁移、依赖感知生命周期及前端失败隔离 | 前端 51 项测试；Rust 34 项自动测试及 1 项可选手动包冒烟 |
| Debugging | 是 | 发现单个失败版本字段会让更早失败的版本重新进入候选；增加失败版本集合并兼容旧字段。静态审查发现未选中版本的依赖也必须阻止 provider 卸载 | `does_not_auto_restore_a_version_that_already_failed_activation`、`blocks_uninstall_for_a_dependency_used_only_by_an_unselected_installed_version` 通过 |
| Code review | 是 | 对照规格检查原子计划、协调升级、禁用/卸载影响、旧状态吸收、provider 失败传播、独立分支继续和仅在计划变化时刷新 | `git diff --check`、`cargo clippy --all-targets -- -D warnings`、OpenSpec strict validate |
| Verification | 是 | 使用测试生成的真实多模块 `.mtp` ZIP 走正式存储验证等待依赖、依赖到达、协调升级、停用/卸载拒绝和回滚安全；使用 V1 `state.json` 验证一次性迁移 | Rust store 集成测试；`pnpm check`；`cargo test`；`pnpm tauri build` |
