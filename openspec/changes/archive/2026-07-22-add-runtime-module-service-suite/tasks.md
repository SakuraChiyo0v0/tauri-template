## 1. SDK V4 契约与关键测试

- [x] 1.1 为 schema V2 / SDK V4、服务声明合法性和 Rust/TypeScript 解析编写关键失败测试
- [x] 1.2 为服务注册、依赖约束调用、JSON 隔离和生命周期清理编写关键失败测试
- [x] 1.3 定义 SDK V4 服务值、处理器和 Host SDK 公共类型

## 2. 基座服务总线

- [x] 2.1 扩展 TypeScript 与 Rust manifest，使 SDK V4 和 `services.provides` 经过一致校验
- [x] 2.2 实现当前 WebView 内的服务注册表、数据复制限制和依赖授权
- [x] 2.3 将服务接口接入 Host SDK 创建与释放，并确保激活失败和停用自动清理
- [x] 2.4 更新基座 README、AI 模块开发指引和 Unreleased 变更记录

## 3. SDK V4 独立模块模板

- [x] 3.1 将模板 manifest、SDK 类型和打包器升级到 SDK V4 服务声明
- [x] 3.2 在预览宿主中模拟服务注册与调用，并更新模板示例和关键测试
- [x] 3.3 更新模板 README 与 AGENTS 开发约束

## 4. 三个独立验证模块

- [x] 4.1 从当前模板创建无远程的 `local-notes`、`notes-dashboard`、`quick-launcher` 独立 Git 仓库
- [x] 4.2 实现 `local-notes` SQLite CRUD、双语页面和 `notes.v1` 服务
- [x] 4.3 实现 `notes-dashboard` 必需依赖、统计页面和服务消费
- [x] 4.4 实现 `quick-launcher` SQLite 入口、HTTPS 校验、托盘与快捷键触发
- [x] 4.5 为每个模块保留最关键行为测试并完成独立打包

## 5. 集成验证与规格收尾

- [x] 5.1 运行基座和模板的类型检查、关键测试、构建及 OpenSpec strict validate
- [x] 5.2 使用真实 `.mtp` 验证消费者等待依赖、提供者补齐后激活和 SDK V4 权限模块安装
- [x] 5.3 确认五个仓库不跟踪构建产物或已安装模块，完成 CodeGraph 同步与静态审查
