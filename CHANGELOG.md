# Changelog

本项目的重要变化记录在此文件中。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增 Host SDK V12 受限 HTTP 代理能力；模块在清单 `nativeCapabilities.http.origins` 声明允许的 HTTPS 源并经用户批准后，可通过 `sdk.http.fetch({ url, method, headers, body, timeoutMs })` 请求。复用既有 V3 原生能力审批与生命周期清理；只允许清单声明的源与 HTTPS，拒绝私有地址防止 SSRF；请求/响应大小与超时受限，不持久 cookie，不执行响应脚本。基于 `reqwest`。
- 新增 Host SDK V11 模块模态对话框能力；模块通过 `sdk.dialogs.confirm(options)` / `prompt(options)` 请求由外壳托管的模态确认或文本输入对话框。外壳负责渲染、焦点陷阱、Esc/Enter 与主题；内容为受限纯文本，不承载富 HTML；串行显示，模块停用时未关闭的对话框自动取消。纯前端能力，不新增原生权限或 Rust 命令。
- 新增 Host SDK V10 模块剪贴板能力；模块在清单 `nativeCapabilities.clipboard` 声明 `text: true` 并经用户批准后，可通过 `sdk.clipboard.readText()` / `writeText(text)` 读写系统剪贴板纯文本。复用既有 V3 原生能力审批与生命周期清理；只支持纯文本，不记录剪贴板正文。基于 `tauri-plugin-clipboard-manager`。
- 新增 Host SDK V9 模块数据导出/导入能力；模块可通过 `sdk.data.exportBackup()` 把自身隔离 SQLite 与私有设置导出为单个归档文件（用户经系统对话框选择位置），用 `sdk.data.importBackup(grantId)` 从归档恢复。模块只收到不透明 grant 摘要不接触真实路径；导入校验归档归属与格式，拒绝其他模块的归档，模块仍活动时拒绝覆盖。不新增原生权限，复用既有外部文件 grant。
- 新增 Host SDK V8 模块系统通知能力；模块在清单 `nativeCapabilities.notifications` 声明 `system: true` 并经用户批准后，可通过 `sdk.notifications.show({ title, body })` 向操作系统发起系统通知。复用既有 V3 原生能力审批、指纹、摘要与生命周期清理；标题与正文为有限长度纯文本，底座截断校验，不附加机密数据。基于 `tauri-plugin-notification`。
- 新增 Host SDK V7 模块事件总线；模块可在清单 `events.publishes` / `events.subscribes` 声明事件，通过 `sdk.events.publish()` 发布数据变化通知，其他模块用 `sdk.events.subscribe()` 自动接收。事件是单向通知、异步投递、按发布顺序、单订阅者异常不影响他人；载荷复用模块服务的受限 JSON 边界并深复制，发布者身份由底座注入不可伪造；模块停用后自动退订且不补投离线事件。订阅不需要把发布者声明为模块依赖。
- 修复 Rust 数据库命令版本范围检查停留在 `2..=5` 的缺陷，SDK V6 模块现在可以正常调用数据库（之前被错误拒绝）；同时支持 V7。

### Changed

- 运行时模块清单与加载器接受 SDK V12；V2–V11 模块继续按原协议运行且不会获得 HTTP 代理能力。
- 独立 `tauri-module-template` 升级为 Host SDK V12，新增受限 HTTP 代理模拟宿主与清单示例。
- 运行时模块清单与加载器接受 SDK V11；V2–V10 模块继续按原协议运行且不会获得对话框能力。
- 独立 `tauri-module-template` 升级为 Host SDK V11，新增模态对话框模拟宿主与清单示例。
- 运行时模块清单与加载器接受 SDK V10；V2–V9 模块继续按原协议运行且不会获得剪贴板能力。
- 独立 `tauri-module-template` 升级为 Host SDK V10，新增剪贴板模拟宿主与清单示例。
- 运行时模块清单与加载器接受 SDK V9；V2–V8 模块继续按原协议运行且不会获得数据迁移能力。
- 独立 `tauri-module-template` 升级为 Host SDK V9，新增数据导出/导入模拟宿主与清单示例。
- 运行时模块清单与加载器接受 SDK V8；V2–V7 模块继续按原协议运行且不会获得通知能力。
- 独立 `tauri-module-template` 升级为 Host SDK V8，新增系统通知模拟宿主与清单示例。
- 运行时模块清单与加载器接受 SDK V7；V2–V6 模块继续按原协议运行且不会获得事件能力。
- 独立 `tauri-module-template` 升级为 Host SDK V7，新增事件总线模拟宿主与清单示例。
- 参考模块 `local-notes` 升级到 SDK V7，便签增删改成功后发布 `notes.changed.v1`；`notes-dashboard` 升级到 SDK V7，订阅该事件自动刷新统计，保留手动刷新。

## [0.3.0] - 2026-07-23

### Added

- 新增 Host SDK V6 本地仓库依赖安装计划；市场可预览传递必需依赖、版本动作与权限变化，并通过短期不透明 `planId` 请求执行。
- 新增多包安装事务与启动恢复记录；最终校验、部分写入或进程中断不会留下半套依赖安装结果。
- 新增 Host SDK V5 受限本地模块仓库能力；获批模块可通过不透明目录授权扫描顶层 `.mtp`，并复用基座校验、依赖解析与回滚流程完成安装或升级。
- 新增独立 `local-module-market` 规划，市场界面、目录记忆和安装交互保持为可拆卸模块，基座不硬编码市场页面。
- 新增 Host SDK V4 模块服务总线，服务注册受清单约束，服务调用受模块依赖约束，并在 SDK 释放时自动清理。
- 新增受限 JSON 服务数据边界，拒绝共享函数、类实例、循环引用、危险原型键和超限数据。
- 新增三个底座外独立验证模块：`local-notes` 服务提供者、`notes-dashboard` 依赖消费者和 `quick-launcher` 原生能力模块。
- 新增底座级中文/英文切换、持久化语言设置和 Host SDK i18n 订阅。
- 新增 Host SDK V3 原生能力代理，覆盖模块私有/授权文件、受控进程、Windows 注册表、统一托盘和全局快捷键。
- 模块管理页新增原生权限摘要、批准/撤销、外部文件 grant 和快捷键冲突重新绑定。
- 新增版本绑定的原生会话令牌，停用、回滚、卸载、激活失败和权限撤销会统一清理资源。
- 新增 Host SDK V2 模块隔离 SQLite，提供参数化查询、执行、事务、schema 用户版本和数据占用清理能力。
- 模块管理页显示已安装与已卸载模块保留的数据库占用，普通卸载不再隐式删除业务数据。
- 新增完全独立的 `tauri-module-template` 开发工作区，提供 Host SDK V2 类型、浏览器预览、测试、单文件构建和确定性 `.mtp` 打包。
- 底座真实包冒烟可以使用当前底座版本验证独立模块的安装、升级、回滚和卸载。

### Changed

- 本地模块市场升级到 0.2.0 / Host SDK V6，安装前展示依赖顺序、版本动作、权限等待和阻塞诊断；过期计划必须重新确认。
- 运行时模块清单与加载器接受 SDK V6；V2–V5 模块继续按原协议运行。
- 运行时模块清单与加载器接受 SDK V5；V2–V4 模块继续按原协议运行且不会获得仓库能力。
- 运行时模块清单与安装器接受 SDK V4 和 `services.provides`；服务型 V4 模块无需为空原生权限执行审批。
- 独立 `tauri-module-template` 升级为 Host SDK V4，并加入模块服务模拟宿主。
- 全局快捷键重新绑定改为居中按键录制弹窗，确认前可反复录制新的组合。
- 运行时模块清单升级为 schema V2，宿主可见文案必须同时提供 `zh-CN` 和 `en`；schema V1 与 Host SDK V1 不再支持。
- 独立 `tauri-module-template` 保持 Host SDK V3 原生能力演示，同时升级为双语 schema V2 和可切换语言的模拟宿主。
- 运行时模块清单支持 `sdkVersion: 3` 与 `nativeCapabilities`；未批准或权限扩大的 V3 版本会保留安装但不会激活。
- 独立 `tauri-module-template` 升级为 Host SDK V3 类型与模拟宿主，并加入私有文件验证路径。
- 清理模块数据库时会保留同目录下的 V3 私有文件，不再因目录非空而误报失败。
- 运行时模块示例源码和专用打包器迁出底座，底座仓库只保留内置模块、运行时加载器和协议测试。

## [0.2.0] - 2026-07-22

### Added

- 运行时模块可以声明带语义版本范围的必需依赖和可选依赖。
- 新增确定性的兼容版本求解、循环检测、provider 优先激活顺序和结构化诊断。
- 模块管理页面可以展示选择版本、可用版本、依赖、依赖者和等待原因。
- 新增全局原子激活计划，支持协调升级、依赖感知的启停、回滚和卸载。
- 新增 CodeGraph 项目索引入口，辅助跨 TypeScript 与 Rust 的调用链分析。
- 新增统一版本检查、升级命令和发布维护说明。

### Changed

- 新模块版本无法形成完整兼容组合时保留为可用版本，不再破坏当前活动组合。
- provider 激活失败只阻止其依赖者，无关模块继续启动。
- 用户安装的 `.mtp` 包和本地模块目录默认不进入 Git。

## [0.1.0] - 2026-07-21

### Added

- 建立最小 Tauri 2、React 和 TypeScript 桌面应用底座。
- 提供模块化侧边栏路由、数据驱动设置、主题令牌和基础 UI 组件。
- 提供统一日志模块及日志查看、筛选、搜索、导出和清空界面。
- 提供本地 `.mtp` 运行时模块安装、独立升级、回滚、停用和卸载生命周期。
- 提供带版本的 Host SDK V1，包含模块日志、私有设置和主题订阅能力。
