## Why

项目版本目前分散在前端包、Rust crate 和 Tauri 配置中，发布时需要手工修改，容易出现版本不一致。随着运行时模块开始根据底座版本判断兼容性，需要一套可重复执行的版本升级和变更记录流程。

## What Changes

- 采用语义化版本规则管理底座版本，并明确 major、minor、patch 的选择标准。
- 提供单一命令同步更新前端、Rust、Tauri 配置及 Rust 锁文件中的项目版本。
- 新增 `CHANGELOG.md`，按照版本记录面向使用者和模块开发者的重要变化。
- 将本次运行时模块依赖系统作为向后兼容的新能力发布为 `0.2.0`。

## Capabilities

### New Capabilities

- `release-version-management`: 定义底座版本同步、语义化升级、变更记录和发布前校验行为。

### Modified Capabilities

无。

## Impact

- 修改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.lock` 中的项目版本。
- 新增版本同步脚本、变更记录和对应验证。
- 不引入远程发布、自动打标签、自动推送或 GitHub Release。
