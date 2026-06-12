# 项目审计、一键分发修复与团队智能体统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一团队智能体数据源并接入全部团队聊天入口，修复一键分发核心链路，完成 DeepSeek 与项目风险审计并给出经验证的结果。

**Architecture:** 新增共享的团队智能体注册表作为单一数据源，让首页、智能体中心与团队聊天选择器统一消费；一键分发前端改为读取统一后端基地址并增强错误处理；最后通过启动 Next 与 FastAPI 做功能验证，并输出审计结论。

**Tech Stack:** Next.js 16, React 19, TypeScript, FastAPI, DeepSeek, 本地开发环境 `pnpm dev:all`

---

## 文件结构

- Create: `f:\A-项目\13-中台网站\lib\team-agents.ts`
- Create: `f:\A-项目\13-中台网站\lib\fastapi-base.ts`
- Modify: `f:\A-项目\13-中台网站\app\page.tsx`
- Modify: `f:\A-项目\13-中台网站\components\dashboard-view.tsx`
- Modify: `f:\A-项目\13-中台网站\components\agent-center.tsx`
- Modify: `f:\A-项目\13-中台网站\components\chat-workspace.tsx`
- Modify: `f:\A-项目\13-中台网站\components\share-distribute.tsx`
- Modify: `f:\A-项目\13-中台网站\main.py`（仅在分享接口稳定性不足时）
- Create: `f:\A-项目\13-中台网站\docs\project-review-2026-06-08.md`

### Task 1: 建立团队智能体单一数据源

**Files:**
- Create: `f:\A-项目\13-中台网站\lib\team-agents.ts`
- Modify: `f:\A-项目\13-中台网站\components\agent-card.tsx`（仅当展示字段不足时）

- [ ] **Step 1: 先写共享类型与首批人物化智能体数据**

```ts
export type TeamAgent = {
  id: string
  name: string
  role: string
  description: string
  avatar: string
  tags: string[]
  status: "online" | "working" | "idle"
  themeColor: string
  quickPrompts: { text: string; iconKey: string }[]
}

export const TEAM_AGENTS: TeamAgent[] = [
  {
    id: "charlie-munger",
    name: "查理·芒格",
    role: "多元思维模型，投资分析师",
    description: "用跨学科框架拆解商业模式、护城河、风险收益比与长期决策质量。",
    avatar: "/agent-3.jpg",
    tags: ["多元思维", "投资分析", "商业判断"],
    status: "online",
    themeColor: "var(--color-amber-500)",
    quickPrompts: [
      { text: "用多元思维模型分析这个项目值不值得做", iconKey: "sparkles" },
      { text: "拆解这门生意的护城河和反脆弱性", iconKey: "briefcase" },
    ],
  },
]
```

- [ ] **Step 2: 补齐 6-10 个团队智能体，覆盖首页与中心页全部展示位**

```ts
{
  id: "drucker",
  name: "彼得·德鲁克",
  role: "管理创新，组织顾问",
  description: "聚焦组织效率、目标管理、岗位协同与管理动作的可执行落地。",
  avatar: "/agent-4.jpg",
  tags: ["目标管理", "组织效率", "流程优化"],
  status: "idle",
  themeColor: "var(--color-sky-500)",
  quickPrompts: [
    { text: "把这项工作拆成岗位责任与交付标准", iconKey: "users" },
    { text: "给这个团队设计一版周会与复盘机制", iconKey: "list-checks" },
  ],
}
```

- [ ] **Step 3: 导出列表与按名称查找方法，避免各页面重复拼接数据**

```ts
export function getTeamAgentByName(name: string): TeamAgent | undefined {
  return TEAM_AGENTS.find((agent) => agent.name === name)
}
```

- [ ] **Step 4: 运行诊断确认新增文件无语法问题**

Run: `pnpm exec tsc --noEmit`
Expected: 不因 `lib/team-agents.ts` 新增内容产生新的 TypeScript 语法错误

- [ ] **Step 5: 提交当前任务**

```bash
git add lib/team-agents.ts
git commit -m "feat: add shared team agent registry"
```

### Task 2: 让首页与智能体中心共用团队智能体数据

**Files:**
- Modify: `f:\A-项目\13-中台网站\components\dashboard-view.tsx`
- Modify: `f:\A-项目\13-中台网站\components\agent-center.tsx`

- [ ] **Step 1: 把首页内嵌 agents 常量替换为共享导入**

```ts
import { TEAM_AGENTS } from "@/lib/team-agents"

const agents: AgentCardProps[] = TEAM_AGENTS.map((agent) => ({
  name: agent.name,
  role: agent.role,
  description: agent.description,
  avatar: agent.avatar,
  tags: agent.tags,
  status: agent.status,
}))
```

- [ ] **Step 2: 把智能体中心内嵌 agents 常量替换为共享导入**

```ts
import { TEAM_AGENTS } from "@/lib/team-agents"

const agents: AgentCardProps[] = TEAM_AGENTS.map((agent) => ({
  name: agent.name,
  role: agent.role,
  description: agent.description,
  avatar: agent.avatar,
  tags: agent.tags,
  status: agent.status,
}))
```

- [ ] **Step 3: 保证打开聊天时能透传头像与角色**

```ts
onOpenAgent(agent.name, {
  avatarUrl: agent.avatar,
  role: agent.role,
})
```

- [ ] **Step 4: 运行诊断确认页面改造后无新增问题**

Run: `pnpm exec tsc --noEmit`
Expected: `dashboard-view.tsx` 和 `agent-center.tsx` 无新增类型错误

- [ ] **Step 5: 提交当前任务**

```bash
git add components/dashboard-view.tsx components/agent-center.tsx
git commit -m "refactor: reuse shared team agents in dashboard and center"
```

### Task 3: 为团队聊天接入智能体选择器

**Files:**
- Modify: `f:\A-项目\13-中台网站\components\chat-workspace.tsx`
- Modify: `f:\A-项目\13-中台网站\app\page.tsx`
- Modify: `f:\A-项目\13-中台网站\lib\team-agents.ts`

- [ ] **Step 1: 给 `ChatWorkspaceProps` 增加团队智能体列表与切换回调**

```ts
export type TeamAgentOption = {
  name: string
  role: string
  avatar: string
  themeColor: string
  quickPrompts: { text: string; iconKey: string }[]
}

export type ChatWorkspaceProps = {
  agentName?: string
  agentAvatarUrl?: string
  agentRole?: string
  allAgents?: TeamAgentOption[]
  onAgentSwitch?: (agentName: string) => void
}
```

- [ ] **Step 2: 在 `chat-workspace.tsx` 顶部工具栏加入选择器 UI**

```tsx
{allAgents && onAgentSwitch ? (
  <div className="flex items-center gap-2">
    <span className="text-xs text-slate-500">智能体选择</span>
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
        <span>{agentName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {allAgents.map((agent) => (
          <DropdownMenuItem key={agent.name} onClick={() => onAgentSwitch(agent.name)}>
            <div className="flex flex-col">
              <span className="font-medium">{agent.name}</span>
              <span className="text-xs text-slate-500">{agent.role}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
) : null}
```

- [ ] **Step 3: 用共享数据驱动团队快捷提问**

```ts
const selectedAgent = allAgents?.find((item) => item.name === agentName)
const resolvedQuickPrompts = selectedAgent?.quickPrompts?.length
  ? selectedAgent.quickPrompts.map((item) => ({ text: item.text, icon: iconMap[item.iconKey] ?? Sparkles }))
  : quickPromptsByAgent[agentName] ?? quickPrompts
```

- [ ] **Step 4: 在 `app/page.tsx` 中构建团队智能体选项并接入切换逻辑**

```ts
import { TEAM_AGENTS, getTeamAgentByName } from "@/lib/team-agents"

const teamAgentOptions = TEAM_AGENTS.map((agent) => ({
  name: agent.name,
  role: agent.role,
  avatar: agent.avatar,
  themeColor: agent.themeColor,
  quickPrompts: agent.quickPrompts,
}))

<ChatWorkspace
  agentName={activeAgent.name}
  agentAvatarUrl={activeAgent.avatarUrl}
  agentRole={activeAgent.role}
  allAgents={teamAgentOptions}
  onAgentSwitch={(name) => {
    const target = getTeamAgentByName(name)
    if (!target) return
    setActiveAgent({
      name: target.name,
      icon: agentIconMap[target.name] || Mic,
      themeColor: target.themeColor,
      avatarUrl: target.avatar,
      role: target.role,
    })
    setIsCopywritingMode(false)
  }}
/>
```

- [ ] **Step 5: 运行诊断确认切换器接入无新增错误**

Run: `pnpm exec tsc --noEmit`
Expected: `app/page.tsx` 与 `chat-workspace.tsx` 无新增类型错误

- [ ] **Step 6: 提交当前任务**

```bash
git add app/page.tsx components/chat-workspace.tsx lib/team-agents.ts
git commit -m "feat: add team agent switcher in chat workspace"
```

### Task 4: 修复一键分发的后端地址与异常处理

**Files:**
- Create: `f:\A-项目\13-中台网站\lib\fastapi-base.ts`
- Modify: `f:\A-项目\13-中台网站\components\share-distribute.tsx`

- [ ] **Step 1: 新增统一后端基地址模块**

```ts
const DEFAULT_FASTAPI_BASE = "http://127.0.0.1:8000"

export function getFastapiBase(): string {
  const raw = process.env.NEXT_PUBLIC_FASTAPI_URL?.trim()
  return raw ? raw.replace(/\/+$/, "") : DEFAULT_FASTAPI_BASE
}
```

- [ ] **Step 2: 在 `ShareDistribute` 中替换硬编码地址**

```ts
import { getFastapiBase } from "@/lib/fastapi-base"

const FASTAPI_BASE = getFastapiBase()

const res = await fetch(`${FASTAPI_BASE}/api/agent/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt }),
})
```

- [ ] **Step 3: 为 AI 自动填写与分享生成补充更稳的异常分支**

```ts
const data = await res.json().catch(() => ({}))
if (!res.ok) {
  throw new Error(typeof data.detail === "string" ? data.detail : "服务暂不可用")
}
if (!data.share_url) {
  throw new Error("未返回分享链接")
}
```

- [ ] **Step 4: 在 UI 中保留人工填写兜底，避免 AI 接口失败阻塞分享**

```ts
toast({
  title: "AI 填写失败",
  description: e instanceof Error ? e.message : "请手动填写后继续生成分享链接",
  variant: "destructive",
})
```

- [ ] **Step 5: 运行诊断确认一键分发页面无新增错误**

Run: `pnpm exec tsc --noEmit`
Expected: `share-distribute.tsx` 与 `fastapi-base.ts` 无新增类型错误

- [ ] **Step 6: 提交当前任务**

```bash
git add lib/fastapi-base.ts components/share-distribute.tsx
git commit -m "fix: centralize fastapi base for share distribute"
```

### Task 5: 核验并补强 FastAPI 分享接口稳定性

**Files:**
- Modify: `f:\A-项目\13-中台网站\main.py`（仅在必要时）

- [ ] **Step 1: 先运行本地 API，确认 `/api/share/generate` 的响应结构满足前端预期**

Run: `python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload`
Expected: 控制台打印 FastAPI 启动成功，`/api/share/generate` 可返回 `share_url`

- [ ] **Step 2: 若接口缺少校验，补最小参数校验与明确错误**

```py
@app.post("/api/share/generate")
async def share_generate(req: ShareGenerateRequest):
    if not req.videoUrl.strip():
        raise HTTPException(status_code=400, detail="videoUrl 不能为空")
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="title 不能为空")
    token = _make_share_token(req.videoUrl)
    ...
```

- [ ] **Step 3: 若跳转页注入内容有转义风险，改为 `json.dumps` 后再插入脚本**

```py
payload = _json_module.dumps(
    {"title": data["title"], "description": data["description"], "tags": data["tags"]},
    ensure_ascii=False,
)
```

- [ ] **Step 4: 用请求验证分享接口**

Run: `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/share/generate -ContentType 'application/json' -Body '{"videoUrl":"https://example.com/a.mp4","title":"测试标题","description":"测试描述","tags":["A","B"]}'`
Expected: 返回包含 `share_token` 和 `share_url`

- [ ] **Step 5: 提交当前任务**

```bash
git add main.py
git commit -m "fix: harden share generate api"
```

### Task 6: 输出项目审计报告

**Files:**
- Create: `f:\A-项目\13-中台网站\docs\project-review-2026-06-08.md`

- [ ] **Step 1: 记录架构结论、已识别风险与修复项**

```md
# 项目审计报告

## 架构结论
- Next.js 单页工作台 + Next AI 网关 + 可选 FastAPI

## 高风险
- 一键分发前端硬编码本地地址
- FastAPI CORS 全开放
- 分享令牌仅内存存储

## 本次已修复
- 团队智能体数据分裂
- 团队聊天缺少选择器
- 一键分发地址不可配置
```

- [ ] **Step 2: 在报告中区分“已修复”和“残余风险”**

```md
## 残余风险
- `ignoreBuildErrors: true` 仍存在
- 分享令牌重启后失效
- 抖音目标站是否读取注入数据受第三方限制
```

- [ ] **Step 3: 运行诊断确认文档无问题**

Run: `pnpm exec tsc --noEmit`
Expected: 文档新增不影响 TypeScript 构建

- [ ] **Step 4: 提交当前任务**

```bash
git add docs/project-review-2026-06-08.md
git commit -m "docs: add project review report"
```

### Task 7: 启动并执行完整验证

**Files:**
- Modify: 无

- [ ] **Step 1: 启动前后端联调环境**

Run: `pnpm dev:all`
Expected: Next 监听 `http://localhost:3000`，FastAPI 监听 `http://127.0.0.1:8000`

- [ ] **Step 2: 验证团队智能体展示与切换**

Run: 手动打开首页、智能体中心、团队聊天
Expected:
- 首页与中心页展示一致的人物化团队智能体
- 打开团队聊天后可切换不同团队智能体
- 切换后角色、头像、快捷提问与会话隔离正确

- [ ] **Step 3: 验证一键分发**

Run: 手动进入“一键分发”
Expected:
- 可选择本地历史视频或手动上传视频
- 可触发 AI 自动填写，失败时可手工继续
- 可生成二维码与分享链接
- 可打开分享链接并完成跳转

- [ ] **Step 4: 验证 DeepSeek 聊天主链路未回归**

Run: 在团队聊天或文案聊天中发送一条测试消息
Expected: 接口返回正常，前端无崩溃，无新错误提示

- [ ] **Step 5: 汇总最终结果**

```md
- 已验证通过：
- 已修复但受第三方限制：
- 未纳入本次修复范围：
```

- [ ] **Step 6: 提交最终结果**

```bash
git add .
git commit -m "feat: unify team agents and verify share workflow"
```
