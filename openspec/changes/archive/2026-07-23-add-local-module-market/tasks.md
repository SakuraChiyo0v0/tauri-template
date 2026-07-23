## 1. 基座权限与包仓库后端

- [x] 1.1 先为 SDK V5 清单、模块仓库权限指纹和旧 SDK 兼容添加 Rust 聚焦测试
- [x] 1.2 实现模块仓库原生权限、只读目录 grant 解析和用户可读摘要
- [x] 1.3 先为仓库扫描、路径拒绝、包替换重校验和升级安装添加 Rust 聚焦测试
- [x] 1.4 实现授权仓库扫描与通过 ModuleStore 安装的 Tauri 命令

## 2. Host SDK V5

- [x] 2.1 先为 V5 API 注入、旧版本隔离和后端调用绑定添加 TypeScript 聚焦测试
- [x] 2.2 实现 `moduleRepository.chooseDirectory/scan/install` 类型、后端和 SDK 分支
- [x] 2.3 更新权限摘要本地化、项目架构说明和基座版本记录

## 3. 独立模块模板

- [x] 3.1 同步 SDK V5 类型、清单校验、模拟仓库 API 和关键测试
- [x] 3.2 更新模板示例与文档，但不把市场业务写进通用模板

## 4. 本地模块市场模块

- [x] 4.1 从独立模板创建 `tauri-modules/local-module-market` 本地 Git 仓库
- [x] 4.2 先为双语页面、目录选择、扫描状态、安装和安全日志添加关键测试
- [x] 4.3 实现可拆卸市场页面、设置持久化、主题/语言订阅和 Host SDK V5 调用

## 5. 验证与制品

- [x] 5.1 运行基座 `pnpm check` 与 Rust 聚焦测试/`cargo check`
- [x] 5.2 运行模板与市场模块 `pnpm check`，打包市场模块并复制到本地模块市场
- [x] 5.3 严格校验 OpenSpec，并确认所有仓库范围与构建产物隔离正确
