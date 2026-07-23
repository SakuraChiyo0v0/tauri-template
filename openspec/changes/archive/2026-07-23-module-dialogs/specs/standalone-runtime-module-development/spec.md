## ADDED Requirements

### Requirement: 模板必须提供可用的 Host SDK V11 对话框开发体验
模板 MUST 提供继承 Host SDK V10 的 Host SDK V11 TypeScript 类型，包括 `dialogs` 命名空间，并 SHALL 在浏览器预览宿主中模拟 `confirm` / `prompt`（浏览器用内存实现同步回显，不真实模态）。模拟只用于开发预览，不得暗示绕过外壳托管。

#### Scenario: 浏览器预览模拟对话框
- **WHEN** 开发者在预览页调用 `hostSdk.dialogs.confirm` 或 `prompt`
- **THEN** 模拟宿主返回结果并回显，不真实渲染系统模态

#### Scenario: 旧版模块不被注入 V11 对话框能力
- **WHEN** 基座加载合法的 Host SDK V2–V10 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V11 对话框能力
