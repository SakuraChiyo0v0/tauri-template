## REMOVED Requirements

### Requirement: 模板必须提供可用的 Host SDK V3 双语开发体验
**Reason**: 当前模板需要验证模块服务调用，而 Host SDK V3 不包含服务接口。

**Migration**: 使用下方 Host SDK V4 双语开发体验；不需要服务的既有 V2/V3 模块仍可继续运行。

## ADDED Requirements

### Requirement: 模板必须提供可用的 Host SDK V4 双语开发体验
模板 MUST 提供继承 Host SDK V3 的 Host SDK V4 TypeScript 类型，并 SHALL 提供模拟模块身份、日志、私有设置、主题、语言、隔离数据库、受控原生能力和模块服务的浏览器预览宿主。模板模块 MUST 包含中文与英文页面词典并在语言变化后重绘；模拟服务和原生能力只用于开发预览，不得暗示绕过清单、依赖、权限或宿主校验。

#### Scenario: 浏览器预览模块页面
- **WHEN** 开发者运行开发命令并在预览页切换语言或调用模拟服务
- **THEN** 模块入口通过模拟 Host SDK V4 激活，页面响应设置、主题、语言和服务结果

#### Scenario: TypeScript 检查 SDK 用法
- **WHEN** 模块代码调用 Host SDK V4 未声明的成员、服务数据类型越界或缺少任一模块页面语言词典
- **THEN** 类型检查或模块测试失败
