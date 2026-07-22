## REMOVED Requirements

### Requirement: 模板必须提供可用的 Host SDK V1 开发体验
**Reason**: 模板已经升级为 schema V2 / SDK V3，继续保留 V1 开发体验会让新模块生成底座明确拒绝的旧协议包。

**Migration**: 使用下方“模板必须提供可用的 Host SDK V3 双语开发体验”需求，并通过当前模板重新构建旧模块。

## ADDED Requirements

### Requirement: 模板必须提供可用的 Host SDK V3 双语开发体验
模板 MUST 提供继承双语 Host SDK V2 基线的 Host SDK V3 TypeScript 类型，并 SHALL 提供模拟模块身份、日志、私有设置、主题、语言、隔离数据库与受控原生能力的浏览器预览宿主。模板模块 MUST 包含中文与英文页面词典并在语言变化后重绘；模拟原生能力只用于开发预览，不得暗示绕过清单声明、用户批准或宿主校验。

#### Scenario: 浏览器预览模块页面
- **WHEN** 开发者运行开发命令并在预览页切换中文与英文
- **THEN** 模块入口通过模拟 Host SDK 激活，清单声明的自定义元素以对应语言渲染并响应设置、主题和语言变化

#### Scenario: TypeScript 检查 SDK 用法
- **WHEN** 模块代码调用 Host SDK V3 未声明的成员或缺少任一模块页面语言词典
- **THEN** 类型检查或模块测试失败

## MODIFIED Requirements

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
