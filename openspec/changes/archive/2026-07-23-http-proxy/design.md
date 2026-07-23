# Design: http-proxy (Host SDK V12)

## 目标

- 让获批的运行时模块能访问清单声明的远程 HTTPS 源，绕过 WebView CORS 但保持受控。
- 作为 V3 原生能力家族新成员，复用既有权限模型。
- V2–V11 模块行为完全不变。

## 非目标

- 不做跨域 cookie 持久化或会话。
- 不做 WebSocket、流式上传/下载或任意 TCP/UDP。
- 不允许访问清单未声明的源，不跟随到清单外源的重定向。
- 不执行响应中的脚本；响应只作为数据返回。

## 关键决策

### 1. 复用 V3 原生能力审批流程

`http` 能力加入 `NativeCapabilities.http`，与现有能力并列。指纹、摘要、`has_kind`、`is_subset_of`、`PermissionStore` 全部复用。权限扩大的更新（新增源）走“等待权限”。

### 2. 能力声明形态

`http: { origins: string[] } | null`。源为 scheme://host[:port] 形式（如 `https://api.example.com`）。底座校验源格式（必须 https），去重排序纳入指纹。请求时底座校验目标 URL 的源是清单声明源的子集；不一致拒绝。

### 3. 请求/响应边界

`sdk.http.fetch({ url, method?, headers?, body? })`：
- `method` 限定 GET/POST/PUT/PATCH/DELETE。
- `headers` 为受限键值对（键名小写校验，拒绝危险头如 `cookie`、`authorization` 由基座管理而非模块设置——本次只允许模块设置常规头，`authorization` 等敏感头在响应中不回传）。
- `body` 为字符串或字节，大小上限 1MB；响应正文大小上限 5MB，超限截断或拒绝。
- 超时默认 15s，可由模块设置上限 30s。
- 不跟随跨源重定向；同源重定向最多 3 次。

### 4. 后端实现

新增 `src-tauri` `http_proxy.rs`，用 `reqwest`（blocking 或 async）发起请求。会话令牌权限校验后调用。返回结构化结果 `{ status, headers, bodyBytes }`，前端按需解码。不持久 cookie。

### 5. SDK 形态

V12 模块获得 `sdk.http`：
- `fetch(options): Promise<{ status: number; headers: Record<string,string>; body: number[] }>`

### 6. 权限边界

未批准时调用返回权限错误；源不在清单时拒绝；HTTPS only。不提供任意网络、本地地址访问（拒绝 localhost/私有 IP 以防 SSRF？保守起见拒绝私有网段）。

## 风险与权衡

- 新增 `reqwest` 依赖（重）；接受成本以获得受控 HTTP。
- SSRF 风险：模块可能尝试访问内网地址。基座拒绝指向私有网段（RFC1918、loopback、link-local）的目标 URL，除非未来明确允许。
- 响应大小限制保护 WebView 内存。
