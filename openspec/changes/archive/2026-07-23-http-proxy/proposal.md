## Why

运行时模块经常需要访问远程接口（例如拉取汇率、查询天气、同步远端数据）。WebView 的 `fetch` 受浏览器同源策略与 CORS 限制，且模块无法携带只读的本地证书；模块也没有一个经审批、限定域的受控 HTTP 通道。结果是要么绕过 CORS 不可行，要么模块被迫通过基座无差别地联网。

## What Changes

- 新增 Host SDK V12 受限 HTTP 代理能力：模块在清单 `nativeCapabilities.http` 中声明允许的源（origin）列表（经用户审批），再通过 `sdk.http.fetch({ url, method?, headers?, body? })` 请求。基座在 Rust 侧用受限 reqwest 客户端发起请求，只允许清单声明的源，返回状态、响应头与正文。
- 作为 V3 原生能力家族新成员，复用既有权限审批、指纹、摘要、撤销与生命周期清理流程。
- 限制：只允许 HTTPS 与清单声明的源；请求/响应大小与超时有上限；不持久 cookie、不跟随跨域重定向到清单外源、不执行脚本；不提供任意 TCP/UDP、不提供文件上传之外的任意流。
- Host SDK V12 = V11 全部能力 + `http` 命名空间；V2–V11 模块行为完全不变。

## Capabilities

### New Capabilities

- `runtime-module-http-proxy`: SDK V12 受限 HTTP 代理的清单声明、权限审批、源校验、内容边界与生命周期清理。

### Modified Capabilities

- `standalone-runtime-module-development`: 模板 Host SDK 类型与模拟宿主从 V11 描述更新到 V12，新增 HTTP 代理模拟预览。

## Impact

- 基座原生：扩展 `NativeCapabilities` 增加 `http`，新增 HTTP 代理模块（reqwest），注册命令与 capability。
- 基座前端：清单解析接受 SDK V12 与 `http` 能力，SDK 构建接入 `sdk.http.fetch`。
- 独立仓库：`tauri-module-template`（SDK 类型、清单示例、模拟宿主、测试）。
- 非目标：跨域 cookie、WebSocket、流式上传/下载、任意 TCP/UDP、未声明源的访问与重定向跟随均不在本次范围。
