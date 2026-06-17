# 任务：项目瘦身（清理缓存/日志/无关文件）

## 目标
- 将项目目录中与主线无关的缓存、日志、临时产物清理掉，解释并处理 `f:\A-项目\13-中台网站\.tmp\node-compile-cache`。
- 在不影响正常开发/启动的前提下，降低磁盘占用与后续膨胀风险。

## 约束
- 先取证、出方案，再执行删除。
- 不删除主线业务代码、必要的依赖锁文件、必要静态资源与文档。
- 删除操作以可复现为准：优先清理可再生成的产物（cache/build/log/db 临时文件等）。

## 工作阶段
### 阶段 1：取证与归因（complete）
- 统计项目体积、Top N 大目录/文件（确认 1.2G 的主要来源）
- 解释 `.tmp/node-compile-cache` 的用途与内容结构
- 盘点与主线无关的候选项（worktrees、__pycache__、tsbuildinfo、next 缓存、pnpm store、日志、历史计划等）
- 明确“可删除/建议保留/需要用户确认”的清单

### 阶段 2：瘦身方案（complete）
- 清理策略（按风险分层：安全删除/需确认/禁止删除）
- `.gitignore` 建议（避免缓存再次进入 git 或被误以为项目内容）
- 启动脚本/开发脚本建议（提供一键 clean，并可选在启动前提示/执行）

### 阶段 3：执行清理（complete）
- 按方案分批删除并复测启动（前端/后端）
- 复测：pnpm dev:all / dev:web + uvicorn 启动不受影响

### 阶段 4：复盘与固化（pending）
- 输出清理前后体积对比
- 提供“一键清理脚本”（可选：clean.bat / pnpm script）

## 需要你确认的点（执行前）
- 是否允许删除：`.next/`、`.tmp/`、`node_modules/`（默认：不删主 `node_modules`）
- 是否允许删除：历史文档/计划（默认：保留 docs；仅删除明显无关且可再生成的临时文件）

## 方案草案（待你确认后执行）
### A. 安全可删（不影响主线；会自动再生成）
- `.next/`（Next.js dev/build 缓存，体积可能很大）
- `.tmp/node-compile-cache/`（Node/V8 编译缓存）
- `.pytest_cache/`、`__pycache__/`、`**/*.pyc`
- `tsconfig.tsbuildinfo`
- `node_modules/.cache/`（若存在，通常是工具链缓存）

### B. 需确认（删了需要重建/可能包含本地数据）
- `data/*.db`（本地 SQLite 数据库：账号/积分等；删除会丢本地数据，但可通过脚本重建）
- `node_modules/`（删了需要重新 pnpm install；且 pnpm 的 junction 可能导致“体积统计”误差）

### C. 不建议删除（主线必须）
- `pnpm-lock.yaml`、`package.json`、`requirements.txt`、业务代码与 public 资源
- `.env`（或你的本地环境变量配置）

### D. 固化（避免反复膨胀）
- 更新 `.gitignore`：覆盖 `.next/`、`.tmp/`、`__pycache__/`、`.pytest_cache/`、`tsconfig.tsbuildinfo` 等
- 新增 `pnpm clean:cache`（或 `scripts/clean.bat`）一键清理 A 类目录
- 若你的系统环境变量配置了 `NODE_COMPILE_CACHE` 指向项目目录，建议改为 `%TEMP%\\node-compile-cache`（避免污染仓库目录）
