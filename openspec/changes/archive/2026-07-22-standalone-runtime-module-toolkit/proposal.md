## Why

运行时模块已经可以独立安装和升级，但开发者仍需从底座仓库复制示例和打包脚本，无法验证“模块源码与底座完全分离”的实际体验。现在需要把 SDK 类型、开发预览、测试和打包流程整理成独立项目模板，并用真实 `.mtp` 包验证底座协议。

## What Changes

- 创建独立的本地 `tauri-module-template` 仓库，不引用底座源码即可安装依赖、开发、测试和打包。
- 提供 Host SDK V1 类型、模拟宿主预览环境、业务中立的验证页面和自包含 `.mtp` 打包工具。
- 使用模板生成至少两个版本的真实模块包，验证底座安装、升级、回滚和卸载协议。
- 从底座仓库移除内嵌示例模块和专用打包脚本，文档改为指向独立模块开发工作区。
- 不新增 Host SDK 能力，不实现模块间服务调用，不创建远程仓库或发布 npm 包。

## Capabilities

### New Capabilities

- `standalone-runtime-module-development`: 定义独立模块模板的开发、预览、测试、打包和底座兼容验证行为。

### Modified Capabilities

无。

## Impact

- 新增相邻本地仓库 `C:/LocalSpace/Projects/Temp-Proj/tauri-module-template`。
- 修改底座 README、AI 开发指引、运行时模块真实包冒烟测试和发布前验证路径。
- 删除底座内 `examples/minimal-runtime-module` 与 `scripts/package-runtime-module.mjs`，保持底座不携带演示模块源码。
- Host SDK V1 和 `.mtp` schemaVersion 1 保持不变。
