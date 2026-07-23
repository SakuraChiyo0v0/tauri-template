## ADDED Requirements

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
