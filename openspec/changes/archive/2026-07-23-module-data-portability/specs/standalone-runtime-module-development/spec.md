## ADDED Requirements

### Requirement: 模板必须提供可用的 Host SDK V9 数据迁移开发体验
模板 MUST 提供继承 Host SDK V8 的 Host SDK V9 TypeScript 类型，包括 `data` 命名空间，并 SHALL 在浏览器预览宿主中模拟导出/导入（浏览器无真实数据库文件，模拟宿主用内存快照往返，不真实写盘）。模拟只用于开发预览，不得暗示绕过 grant 或归属校验。

#### Scenario: 浏览器预览模拟导出导入
- **WHEN** 开发者在预览页调用 `hostSdk.data.exportBackup()` 后再 `importBackup`
- **THEN** 模拟宿主用内存快照完成往返并回显摘要，不真实读写磁盘

#### Scenario: 旧版模块不被注入 V9 数据能力
- **WHEN** 基座加载合法的 Host SDK V2–V8 模块
- **THEN** 基座 SHALL 继续提供对应版本的原有 API，且不得向旧模块注入 V9 数据能力
