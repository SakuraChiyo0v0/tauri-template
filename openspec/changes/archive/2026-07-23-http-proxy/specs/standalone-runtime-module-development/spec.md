## ADDED Requirements

### Requirement: 模板必须提供可用的 Host SDK V12 HTTP 代理开发体验
模板 MUST 提供继承 Host SDK V11 的 Host SDK V12 TypeScript 类型，包括 `http` 命名空间，并 SHALL 在浏览器预览宿主中模拟 `fetch`（浏览器用内存固定回显，不真实联网）。模拟只用于开发预览，不得暗示绕过清单或权限审批。

#### Scenario: 浏览器预览模拟 HTTP 请求
- **WHEN** 开发者在预览页调用 `hostSdk.http.fetch`
- **THEN** 模拟宿主返回固定回显结果，不真实发起网络请求

#### Scenario: 旧版模块不被注入 V12 HTTP 能力
- **WHEN** 基座加载合法的 Host SDK V2–V11 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V12 HTTP 能力
