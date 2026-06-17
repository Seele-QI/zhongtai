# 发现记录：项目瘦身（取证）

## 目录概览（顶层）
- 存在明显“可再生成/缓存”目录：`.next/`、`.tmp/`、`.pytest_cache/`、`.vercel/`、`__pycache__/`
- 存在依赖目录：`node_modules/`（通常就是磁盘占用的大头；不建议“清理”而是按需重装）

## 已采样的体积（部分）
- `.tmp`：约 1.3 MB（535 files）
- `.next`：约 232.7 MB（608 files）
- `.git`：约 10.7 MB（102 files）
- `superpowers-main`：约 0.9 MB（147 files）

## `.tmp/node-compile-cache` 说明
- 结构：`.tmp/node-compile-cache/<node版本-架构-构建标识>/` 下大量“无扩展名的十六进制文件名”（例如 `00026546`、`0a01ba52`）。
- 含义：这是 Node/V8 的“代码编译缓存”（compile cache）。每个小文件通常对应某个被 Node 执行过的 JS/TS 编译产物缓存项，用于加速后续启动/热更新。
- 安全性：可安全删除（删除后会自动再生成）；建议加入忽略规则，避免把缓存当作项目内容。

