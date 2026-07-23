## ADDED Requirements

### Requirement: 模板必须提供可用的 Host SDK V10 剪贴板开发体验
模板 MUST 提供继承 Host SDK V9 的 Host SDK V10 TypeScript 类型，包括 `clipboard` 命名空间，并 SHALL 在浏览器预览宿主中模拟剪贴板读写（浏览器用内存缓冲往返，不真实访问系统剪贴板）。模拟只用于开发预览，不得暗示绕过清单或权限审批。

#### Scenario: 浏览器预览模拟剪贴板
- **WHEN** 开发者在预览页调用 `hostSdk.clipboard.writeText` 后再 `readText`
- **THEN** 模拟宿主用内存缓冲完成往返并回显，不真实访问系统剪贴板

#### Scenario: 旧版模块不被注入 V10 剪贴板能力
- **WHEN** 基座加载合法的 Host SDK V2–V9 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V10 剪贴板能力
