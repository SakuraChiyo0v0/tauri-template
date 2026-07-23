# runtime-module-http-proxy Specification

## Purpose
TBD - created by archiving change http-proxy. Update Purpose after archive.
## Requirements
### Requirement: 模块必须声明并获批 HTTP 代理能力
SDK V12 模块 MUST 在清单 `nativeCapabilities.http` 中声明允许的源列表（`origins`），底座 MUST 把 HTTP 能力纳入指纹、摘要与权限审批流程。源 MUST 为 `https://` 形式。底座 MUST 拒绝 V2–V11 模块声明 HTTP 能力。未批准的模块 MUST NOT 发起 HTTP 请求。

#### Scenario: 声明并获批 HTTP 能力
- **WHEN** SDK V12 模块在清单声明 `http.origins` 且用户批准
- **THEN** 模块获得 `sdk.http.fetch` 调用资格

#### Scenario: 拒绝低版本模块声明 HTTP
- **WHEN** SDK V2–V11 模块清单包含 `http` 声明
- **THEN** 清单校验失败且模块不会安装

#### Scenario: 拒绝非 HTTPS 源
- **WHEN** 声明的源使用非 `https` scheme
- **THEN** 清单校验失败

#### Scenario: 未批准时拒绝请求
- **WHEN** 模块声明了 HTTP 能力但当前权限未批准或已撤销
- **THEN** `fetch` 调用返回权限错误且不发起网络请求

### Requirement: HTTP 请求必须限于清单声明的源
`sdk.http.fetch` 的目标 URL 源 MUST 是清单声明源的子集，底座 MUST 拒绝清单外源或指向私有网段（loopback、RFC1918、link-local）的目标以防止 SSRF。

#### Scenario: 请求声明源
- **WHEN** 获批模块请求一个清单声明源下的 HTTPS URL
- **THEN** 基座发起请求并返回响应

#### Scenario: 拒绝未声明源
- **WHEN** 目标 URL 源不在清单声明中
- **THEN** 请求被拒绝且不发起网络请求

#### Scenario: 拒绝私有地址
- **WHEN** 目标主机解析到私有网段或 loopback
- **THEN** 请求被拒绝

### Requirement: HTTP 请求与响应必须受边界约束
方法 MUST 限于 GET/POST/PUT/PATCH/DELETE；请求与响应正文 MUST 有大小上限并截断或拒绝；超时 MUST 有上限。底座 MUST NOT 持久 cookie 或执行响应脚本，不跟随跨源重定向；同源重定向最多 3 次。

#### Scenario: 截断超限响应
- **WHEN** 响应正文超过上限
- **THEN** 底座按上限截断后返回，不因大小拒绝合法请求

#### Scenario: 拒绝危险方法
- **WHEN** 方法不是允许集合
- **THEN** 请求被拒绝

### Requirement: HTTP 能力必须随模块生命周期清理
底座 MUST 在模块激活失败、停用、卸载、权限撤销或计划重载时使该模块的 HTTP 会话失效。失效后的模块 MUST NOT 发起请求。

#### Scenario: 模块停用后拒绝请求
- **WHEN** 模块 Host SDK 被释放后调用 `fetch`
- **THEN** 调用返回会话失效错误且不发起网络请求

