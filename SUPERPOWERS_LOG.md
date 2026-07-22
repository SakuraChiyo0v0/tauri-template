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

## Standalone runtime module toolkit

| 检查点 | 是否触发 | 决定或行动 | 证据 |
| --- | --- | --- | --- |
| Brainstorming | 是 | 将模块开发工具迁到独立仓库，只通过 Host SDK V1 和 `.mtp` schemaVersion 1 与底座交互；模块服务层、远程仓库和 npm SDK 留在后续变更 | `openspec/changes/standalone-runtime-module-toolkit/proposal.md`、`design.md`、capability spec |
| TDD | 是 | 先覆盖 Host SDK 激活、设置与主题响应、版本覆盖、确定性打包和危险输入，再实现模板与打包器 | 独立模板 15 项测试通过 |
| Debugging | 是 | pnpm 11 需要显式允许 esbuild；静态审查又发现顶层资源符号链接和夹带未知 CLI 参数未拒绝，均补回归测试 | `pnpm-workspace.yaml`；`scripts/pack.test.mjs` |
| Code review | 是 | 对照规格检查底座源码耦合、清单/入口布局、危险路径与链接、Git 忽略边界、当前 host 版本及底座示例清理 | 无底座源码导入；`git diff --check`；OpenSpec strict validate |
| Verification | 是 | 独立安装、类型检查、15 项测试、单文件构建和双次同哈希打包；使用 0.1.0/0.1.1 真实包走底座安装、升级、回滚和卸载 | SHA-256 `709F23ED8A8ACCC24CA7B556A8508DABCBCD435D860CD6B87C835F7B20563C3E`；真实包 Rust 冒烟通过；底座前端/Rust/Clippy 通过 |

## Runtime module SQLite storage

| 检查点 | 是否触发 | 决定或行动 | 证据 |
| --- | --- | --- | --- |
| Brainstorming | 是 | 每个模块使用独立数据库文件；跨模块共享留给版本化服务层；Host SDK V1/V2 按清单协商 | `openspec/changes/runtime-module-sqlite-storage/proposal.md`、`design.md`、三份 capability delta spec |
| TDD | 是 | 先覆盖隔离、持久化、事务回滚、危险 SQL、资源上限、数据清理、SDK 协商和管理页数据规则，再实现 SQLite 与 Host SDK V2 | Rust 4 项数据库自动测试及 1 项真实包手动冒烟；前端新增 6 项契约测试 |
| Debugging | 是 | 类型检查发现泛型查询 mock 与 SDK 基础对象推断不兼容；改为显式判别 SDK 类型和泛型包装。静态审查补充事务语句数量上限 | `pnpm typecheck`、`rejects_unsafe_sql_ids_and_unbounded_results` 通过 |
| Code review | 是 | 检查模块 ID 路径、ATTACH/DETACH/PRAGMA/扩展拒绝、单语句和只读约束、V1 对象不泄露数据库、活动模块清理保护及孤立数据可见性 | CodeGraph 调用链复核；`cargo clippy --all-targets -- -D warnings`；OpenSpec strict validate |
| Verification | 是 | 独立 V2 模板完成迁移与读写模拟；真实 `.mtp` 走安装、写入、重启读取、停用、卸载保留和清理；发布构建包含 bundled SQLite | 底座 70 项前端测试、39 项 Rust 自动测试；模板 15 项测试；MSI 与 NSIS 构建成功 |
