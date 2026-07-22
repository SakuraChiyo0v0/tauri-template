## ADDED Requirements

### Requirement: 外部打开操作必须受声明和授权约束
底座 MUST 只允许模块打开清单声明且用户批准 scheme 的 URL，并只允许通过本模块文件 grant 打开文件或在系统文件管理器中定位目标。

#### Scenario: 打开获批 URL scheme
- **WHEN** 模块请求打开 URL 且 scheme 位于批准列表
- **THEN** 底座使用系统默认处理程序打开 URL

#### Scenario: 拒绝未声明 scheme
- **WHEN** 模块请求清单未声明的 scheme 或无 scheme 的命令字符串
- **THEN** 底座返回权限错误且不启动任何处理程序

#### Scenario: 定位已授权文件
- **WHEN** 模块使用自己的有效文件 grant 请求在文件管理器中定位
- **THEN** 底座打开系统文件管理器并选中或展示该目标

### Requirement: 可执行程序必须由用户选择并直接启动
模块 MUST 通过底座选择器获得 executable grant 才能运行外部程序。底座 MUST 使用直接进程 API 启动所选文件，不得经过 Shell、命令字符串、管理员提权或模块指定的任意工作目录。

#### Scenario: 运行用户授权程序
- **WHEN** 用户已为模块选择可执行文件且模块提供有界参数列表
- **THEN** 底座直接启动该可执行文件并返回退出码、受限标准输出和标准错误

#### Scenario: 拒绝 Shell 命令
- **WHEN** 模块提交管道、重定向、Shell 内建命令或未经 grant 的可执行路径
- **THEN** 底座在创建进程前拒绝请求

### Requirement: 进程执行必须限制资源和生命周期
进程 `run` API MUST 限制参数数量与长度、环境变量、运行超时和输出总量。超时或输出超限时底座 MUST 终止子进程并返回结构化原因；首版不得提供脱离会话的后台 `spawn`。

#### Scenario: 进程正常退出
- **WHEN** 授权程序在时限内完成且输出未超限
- **THEN** Host SDK 返回退出码和完整的有界输出

#### Scenario: 进程执行超时
- **WHEN** 授权程序超过底座允许的最长时间
- **THEN** 底座终止该进程、返回 `timeout`，并释放相关句柄

#### Scenario: 模块停用期间存在运行命令
- **WHEN** 模块被停用或权限被撤销时仍有由其会话启动的命令
- **THEN** 底座终止命令并使旧会话无法启动新进程
