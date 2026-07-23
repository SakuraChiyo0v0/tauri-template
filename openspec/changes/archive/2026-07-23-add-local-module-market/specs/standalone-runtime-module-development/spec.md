## MODIFIED Requirements

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
