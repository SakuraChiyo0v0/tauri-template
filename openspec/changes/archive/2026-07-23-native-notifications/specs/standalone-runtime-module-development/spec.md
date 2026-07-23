## ADDED Requirements

### Requirement: 模板必须提供可用的 Host SDK V8 通知开发体验
模板 MUST 提供继承 Host SDK V7 的 Host SDK V8 TypeScript 类型，包括 `notifications` 命名空间，并 SHALL 在浏览器预览宿主中模拟通知发送（浏览器无系统通知，模拟宿主仅记录意图并回显，不真实推送）。模拟通知只用于开发预览，不得暗示绕过清单或权限审批。

#### Scenario: 浏览器预览模拟通知
- **WHEN** 开发者在预览页调用 `hostSdk.notifications.show`
- **THEN** 模拟宿主记录通知标题与正文并回显，不真实调用系统通知

#### Scenario: 旧版模块不被注入 V8 通知能力
- **WHEN** 基座加载合法的 Host SDK V2–V7 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V8 通知能力
