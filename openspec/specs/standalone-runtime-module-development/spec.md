# standalone-runtime-module-development Specification

## Purpose

定义运行时模块在独立仓库中的开发、预览、构建、打包与底座集成验证要求，使模块能够脱离底座源码开发并生成可复现的本地安装包。
## Requirements
### Requirement: 模块模板必须脱离底座源码运行
独立模块模板 MUST 在没有底座仓库源码和相对路径依赖的情况下完成依赖安装、类型检查、测试、构建和打包。模板 SHALL 只通过版本化 Host SDK 类型和 `.mtp` 包协议依赖底座。

#### Scenario: 独立工作区执行检查
- **WHEN** 开发者在模块模板仓库安装依赖并运行检查命令
- **THEN** 类型检查、模块测试和生产构建全部成功，且不读取底座工作区文件

#### Scenario: 检测底座源码耦合
- **WHEN** 模板源码包含指向底座 `src` 或 `src-tauri` 的导入
- **THEN** 仓库检查失败或静态审查能够直接识别该违规依赖

### Requirement: 模板必须生成合规且可复现的模块包
打包命令 MUST 生成扩展名为 `.mtp` 的 ZIP 包，根目录包含合法且双语完整的 schema V2 `manifest.json` 和单文件 ESM `index.js`，并只包含安全的相对资源路径。相同输入和版本 MUST 生成字节一致的包。

#### Scenario: 打包默认版本
- **WHEN** 开发者运行模块打包命令且清单全部双语字段有效
- **THEN** `dist` 中生成名称包含模块 ID 和清单版本的 `.mtp` 文件

#### Scenario: 拒绝单语言清单
- **WHEN** 模块清单任一宿主文案缺少 `zh-CN`、`en` 或包含空白值
- **THEN** 检查和打包命令失败且不生成 `.mtp` 产物

#### Scenario: 覆盖冒烟版本
- **WHEN** 开发者通过命令显式指定比清单更高的合法语义版本
- **THEN** 产物清单和文件名使用该版本，但源码清单保持不变

#### Scenario: 拒绝不安全资源
- **WHEN** 打包输入包含绝对路径、父目录跳转或符号链接
- **THEN** 打包命令失败且不生成可安装产物

### Requirement: 底座必须用独立产物验证生命周期
底座 SHALL 提供显式集成验证路径，使用独立模板生成的两个真实 `.mtp` 版本验证安装、升级、回滚和卸载。验证 MUST 使用当前底座 crate 版本进行 `hostVersion` 兼容判断。

#### Scenario: 验证真实模块升级与回滚
- **WHEN** 集成测试依次接收同一模块的两个兼容版本
- **THEN** 底座安装旧版本、升级到新版本、回滚到旧版本并最终卸载，且每一步状态符合模块包生命周期规格

#### Scenario: 普通测试不依赖外部仓库
- **WHEN** 未提供真实包环境变量而运行默认 Rust 测试
- **THEN** 外部包冒烟保持忽略，其他测试正常执行

### Requirement: 底座仓库必须保持无运行时示例源码
底座仓库 MUST 只保留内置源码模块、运行时加载器和协议测试，不得保存供用户安装的演示模块源码或其专用打包产物。开发文档 SHALL 指向独立模块模板工作区。

#### Scenario: 检查底座仓库内容
- **WHEN** 维护者查看底座的 Git 跟踪文件
- **THEN** 不存在 `examples/minimal-runtime-module`、模块 `.mtp` 产物或仅服务于该示例的打包脚本

### Requirement: 模板必须提供可用的 Host SDK V5 双语开发体验
模板 MUST 提供继承 Host SDK V4 的 Host SDK V5 TypeScript 类型，并 SHALL 提供模拟模块身份、日志、私有设置、主题、语言、隔离数据库、受控原生能力、模块服务和本地模块仓库的浏览器预览宿主。模板模块 MUST 包含中文与英文页面词典并在语言变化后重绘；模拟服务、仓库和原生能力只用于开发预览，不得暗示绕过清单、目录 grant、依赖、权限或宿主校验。

#### Scenario: 浏览器预览模块页面
- **WHEN** 开发者运行开发命令并在预览页切换语言、调用模拟服务或扫描模拟仓库
- **THEN** 模块入口通过模拟 Host SDK V5 激活，页面响应设置、主题、语言、服务和仓库结果

#### Scenario: TypeScript 检查 SDK 用法
- **WHEN** 模块代码调用 Host SDK V5 未声明的成员、服务或仓库数据类型越界，或缺少任一模块页面语言词典
- **THEN** 类型检查或模块测试失败

#### Scenario: 旧版模块继续运行
- **WHEN** 基座加载合法的 Host SDK V2、V3 或 V4 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V5 仓库能力

### Requirement: 模板必须提供可用的 Host SDK V7 事件总线开发体验
模板 MUST 提供继承 Host SDK V6 的 Host SDK V7 TypeScript 类型，包括 `events` 命名空间与事件信封类型，并 SHALL 在浏览器预览宿主中按清单声明模拟事件发布、订阅、信封注入与未声明拒绝。模板模块 MUST 能在预览页发布与订阅已声明事件并立即看到投递。模拟事件、服务和原生能力只用于开发预览，不得暗示绕过清单、依赖、权限或宿主校验。

#### Scenario: 浏览器预览发布与订阅事件
- **WHEN** 开发者运行开发命令并在预览页发布一个清单声明的事件
- **THEN** 已订阅该事件的监听器收到底座注入的信封，包含事件 ID、发布者模块 ID、时间与隔离载荷副本

#### Scenario: TypeScript 检查事件 API 用法
- **WHEN** 模块代码调用 Host SDK V7 未声明的事件、使用越界的事件数据类型或缺少任一模块页面语言词典
- **THEN** 类型检查或模块测试失败

#### Scenario: 旧版模块不被注入 V7 事件能力
- **WHEN** 基座加载合法的 Host SDK V2、V3、V4、V5 或 V6 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V7 事件能力

### Requirement: 模板必须提供可用的 Host SDK V8 通知开发体验
模板 MUST 提供继承 Host SDK V7 的 Host SDK V8 TypeScript 类型，包括 `notifications` 命名空间，并 SHALL 在浏览器预览宿主中模拟通知发送（浏览器无系统通知，模拟宿主仅记录意图并回显，不真实推送）。模拟通知只用于开发预览，不得暗示绕过清单或权限审批。

#### Scenario: 浏览器预览模拟通知
- **WHEN** 开发者在预览页调用 `hostSdk.notifications.show`
- **THEN** 模拟宿主记录通知标题与正文并回显，不真实调用系统通知

#### Scenario: 旧版模块不被注入 V8 通知能力
- **WHEN** 基座加载合法的 Host SDK V2–V7 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V8 通知能力

### Requirement: 模板必须提供可用的 Host SDK V9 数据迁移开发体验
模板 MUST 提供继承 Host SDK V8 的 Host SDK V9 TypeScript 类型，包括 `data` 命名空间，并 SHALL 在浏览器预览宿主中模拟导出/导入（浏览器无真实数据库文件，模拟宿主用内存快照往返，不真实写盘）。模拟只用于开发预览，不得暗示绕过 grant 或归属校验。

#### Scenario: 浏览器预览模拟导出导入
- **WHEN** 开发者在预览页调用 `hostSdk.data.exportBackup()` 后再 `importBackup`
- **THEN** 模拟宿主用内存快照完成往返并回显摘要，不真实读写磁盘

#### Scenario: 旧版模块不被注入 V9 数据能力
- **WHEN** 基座加载合法的 Host SDK V2–V8 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V9 数据能力

### Requirement: 模板必须提供可用的 Host SDK V10 剪贴板开发体验
模板 MUST 提供继承 Host SDK V9 的 Host SDK V10 TypeScript 类型，包括 `clipboard` 命名空间，并 SHALL 在浏览器预览宿主中模拟剪贴板读写（浏览器用内存缓冲往返，不真实访问系统剪贴板）。模拟只用于开发预览，不得暗示绕过清单或权限审批。

#### Scenario: 浏览器预览模拟剪贴板
- **WHEN** 开发者在预览页调用 `hostSdk.clipboard.writeText` 后再 `readText`
- **THEN** 模拟宿主用内存缓冲完成往返并回显，不真实访问系统剪贴板

#### Scenario: 旧版模块不被注入 V10 剪贴板能力
- **WHEN** 基座加载合法的 Host SDK V2–V9 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V10 剪贴板能力

### Requirement: 模板必须提供可用的 Host SDK V11 对话框开发体验
模板 MUST 提供继承 Host SDK V10 的 Host SDK V11 TypeScript 类型，包括 `dialogs` 命名空间，并 SHALL 在浏览器预览宿主中模拟 `confirm` / `prompt`（浏览器用内存实现同步回显，不真实模态）。模拟只用于开发预览，不得暗示绕过外壳托管。

#### Scenario: 浏览器预览模拟对话框
- **WHEN** 开发者在预览页调用 `hostSdk.dialogs.confirm` 或 `prompt`
- **THEN** 模拟宿主返回结果并回显，不真实渲染系统模态

#### Scenario: 旧版模块不被注入 V11 对话框能力
- **WHEN** 基座加载合法的 Host SDK V2–V10 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V11 对话框能力

### Requirement: 模板必须提供可用的 Host SDK V12 HTTP 代理开发体验
模板 MUST 提供继承 Host SDK V11 的 Host SDK V12 TypeScript 类型，包括 `http` 命名空间，并 SHALL 在浏览器预览宿主中模拟 `fetch`（浏览器用内存固定回显，不真实联网）。模拟只用于开发预览，不得暗示绕过清单或权限审批。

#### Scenario: 浏览器预览模拟 HTTP 请求
- **WHEN** 开发者在预览页调用 `hostSdk.http.fetch`
- **THEN** 模拟宿主返回固定回显结果，不真实发起网络请求

#### Scenario: 旧版模块不被注入 V12 HTTP 能力
- **WHEN** 基座加载合法的 Host SDK V2–V11 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V12 HTTP 能力

