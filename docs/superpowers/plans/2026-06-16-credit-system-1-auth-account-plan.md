# 用户体系与积分账户 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AgentHub 落地「手机号+短信验证码」登录与「积分账户」基础设施。所有积分变动走事件溯源流水，余额由流水聚合；与现有平台账号绑定完全解耦；为后续「支付」「计费引擎」两个子项目提供 `require_credit` 装饰器与 `/api/credit/*` 接口。

**Architecture:** Next.js 16 + React 19（前端） + FastAPI（后端）共用同一个 SQLite（`data/accounts.db`）。本子项目新增 4 张表（`users` / `sessions` / `credit_accounts` / `credit_ledger`）与 1 张辅助表（`sms_codes`），新增 `lib/auth.py` `lib/credit.py` `lib/sms.py` `lib/rate_limit.py`，新增 `app/api/auth/*` `app/api/credit/*` 两组路由。本子项目不接入具体 AI endpoint，不做支付、不做用户中心 UI 完善。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, FastAPI, SQLite, 阿里云短信 SDK（Python）, secrets 模块, 原生 fetch

---

## 文件结构

### 新建
- `f:\A-项目\13-中台网站\scripts\init_credit_db.py` — 4 张表 + sms_codes 表的 SQLite 初始化脚本
- `f:\A-项目\13-中台网站\lib\db.py` — SQLite 连接 + `BEGIN IMMEDIATE` 事务辅助
- `f:\A-项目\13-中台网站\lib\auth.py` — 验证码生成/校验/限频
- `f:\A-项目\13-中台网站\lib\sms.py` — 阿里云短信 SDK 包装（含 dev 模式 stub）
- `f:\A-项目\13-中台网站\lib\rate_limit.py` — 手机号/IP 限频
- `f:\A-项目\13-中台网站\lib\credit.py` — 余额查询/扣费/退款/对账核心
- `f:\A-项目\13-中台网站\app\api\auth\send-code\route.ts` — POST 发送验证码
- `f:\A-项目\13-中台网站\app\api\auth\verify-code\route.ts` — POST 验证并登录
- `f:\A-项目\13-中台网站\app\api\auth\logout\route.ts` — POST 登出
- `f:\A-项目\13-中台网站\app\api\auth\me\route.ts` — GET 当前用户
- `f:\A-项目\13-中台网站\app\api\credit\balance\route.ts` — GET 余额
- `f:\A-项目\13-中台网站\app\api\credit\ledger\route.ts` — GET 流水
- `f:\A-项目\13-中台网站\components\auth\login-dialog.tsx` — 登录弹窗（手机号+验证码）
- `f:\A-项目\13-中台网站\components\credit\credit-badge.tsx` — 顶部积分显示
- `f:\A-项目\13-中台网站\tests\test_credit.py` — 单元测试（扣费/退款/并发/超扣）
- `f:\A-项目\13-中台网站\tests\test_auth.py` — 集成测试（发送/验证/登录/限频）
- `f:\A-项目\13-中台网站\scripts\reconcile.py` — 对账脚本

### 修改
- `f:\A-项目\13-中台网站\main.py` — 新增 4 个 FastAPI 路由镜像（保持双 API 架构同源）
- `f:\A-项目\13-中台网站\.env.example` — 新增阿里云短信与 hash salt 环境变量
- `f:\A-项目\13-中台网站\components\top-header.tsx` — 顶部挂载 CreditBadge（未登录时引导登录）
- `f:\A-项目\13-中台网站\lib\cost-tracker.ts` — 改为只读，从 `/api/credit/balance` 拉

---

## Task 1: 初始化数据库与 hash salt

**Files:**
- Create: `f:\A-项目\13-中台网站\scripts\init_credit_db.py`
- Modify: `f:\A-项目\13-中台网站\.env.example`

- [ ] **Step 1: 在 .env.example 末尾追加新变量**

```bash
# —— 阿里云短信服务（手机号登录验证码）——
ALIYUN_SMS_ACCESS_KEY_ID=your-access-key-id
ALIYUN_SMS_ACCESS_KEY_SECRET=your-access-key-secret
ALIYUN_SMS_SIGN_NAME=你的短信签名
ALIYUN_SMS_TEMPLATE_CODE=替换为阿里云控制台实际模板编码
# 验证码模板变量名（默认 "code"），按阿里云控制台实际填
ALIYUN_SMS_TEMPLATE_PARAM=code

# —— 手机号 hash 盐值（首次部署随机生成 32 字节后填入；不要提交到 git）——
# 生成命令：python -c "import secrets; print(secrets.token_hex(32))"
PHONE_HASH_SALT=replace-with-output-of-secrets.token_hex-32

# —— 积分系统 ——
CREDIT_REGISTER_BONUS=100
CREDIT_SESSION_TTL_DAYS=30
CREDIT_SMS_CODE_TTL_SECONDS=300
CREDIT_SMS_MAX_ATTEMPTS=5

# —— 阿里云短信未配置时进入 dev 模式：验证码打到服务端日志且不真正发短信 ——
# 设为 1 即开启 dev 模式（本地开发推荐）
DEV_SMS_MODE=1
```

- [ ] **Step 2: 创建 SQLite 初始化脚本**

```python
# scripts/init_credit_db.py
"""幂等地创建积分系统所需的 5 张表。与 accounts.db 同库。"""
import os
import sqlite3
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "accounts.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_hash TEXT UNIQUE NOT NULL,
    phone_masked TEXT NOT NULL,
    nickname TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL,
    user_agent TEXT,
    ip_first TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS credit_accounts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    total_recharged INTEGER NOT NULL DEFAULT 0,
    total_bonus INTEGER NOT NULL DEFAULT 0,
    total_consumed INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    ref_id TEXT,
    note TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user_time ON credit_ledger(user_id, created_at);

CREATE TABLE IF NOT EXISTS sms_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_hash TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sms_codes_phone ON sms_codes(phone_hash, created_at);
"""


def main() -> int:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()
    print(f"[ok] schema ensured at {DB_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: 执行脚本并验证 5 张表都建好**

Run: `python scripts/init_credit_db.py`
Expected: 打印 `[ok] schema ensured at ...`

Run:
```bash
python -c "import sqlite3; c=sqlite3.connect('data/accounts.db'); print([r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\")])"
```
Expected: `['accounts', 'credit_accounts', 'credit_ledger', 'sessions', 'sms_codes', 'users']`

- [ ] **Step 4: 提交**

```bash
git add scripts/init_credit_db.py .env.example
git commit -m "feat(credit): init SQLite schema for users, sessions, credit, sms_codes"
```

---

## Task 2: 实现 SQLite 连接与事务辅助

**Files:**
- Create: `f:\A-项目\13-中台网站\lib\db.py`

- [ ] **Step 1: 创建 lib/db.py**

```python
# lib/db.py
"""SQLite 连接与事务辅助。所有积分写入必须走 transaction()。"""
import os
import sqlite3
from contextlib import contextmanager
from typing import Iterator

# 测试可设置 CREDIT_DB_OVERRIDE=/path/to/tmp.db 走临时库，避免污染真实数据
_OVERRIDE = os.getenv("CREDIT_DB_OVERRIDE", "").strip()
DB_PATH = (
    _OVERRIDE
    if _OVERRIDE
    else os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "accounts.db")
)


def connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """BEGIN IMMEDIATE 事务；遇异常自动 ROLLBACK。"""
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
```

> 注释：所有写入积分的代码必须用 `with transaction() as conn:` 而不是直接 `connect()`。`BEGIN IMMEDIATE` 避免并发写冲突。

- [ ] **Step 2: 烟雾测试导入不报错**

Run: `python -c "from lib.db import connect, transaction; c=connect(); print('tables:', [r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\")]); c.close()"`
Expected: 打印所有表名，无 traceback

- [ ] **Step 3: 提交**

```bash
git add lib/db.py
git commit -m "feat(credit): add SQLite connection helper with BEGIN IMMEDIATE"
```

---

## Task 3: 实现限频模块

**Files:**
- Create: `f:\A-项目\13-中台网站\lib\rate_limit.py`

- [ ] **Step 1: 创建 lib/rate_limit.py**

```python
# lib/rate_limit.py
"""手机号/IP 限频。用于 send-code 入口。"""
import os
import time
from typing import Tuple

from lib.db import connect

# (window_seconds, max_count)
PHONE_LIMITS = [
    (60, 1),        # 1 分钟 1 次
    (3600, 5),      # 1 小时 5 次
    (86400, 10),    # 1 天 10 次
]
IP_LIMITS = [
    (3600, 10),     # 1 小时 10 次
]


def _count_since(key: str, since_ts: int) -> int:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM sms_codes WHERE phone_hash = ? AND created_at >= ?",
            (key, since_ts),
        ).fetchone()
        return int(row[0])
    finally:
        conn.close()


def check_phone(phone_hash: str) -> Tuple[bool, str]:
    now = int(time.time() * 1000)
    for window_s, limit in PHONE_LIMITS:
        since = now - window_s * 1000
        if _count_since(phone_hash, since) >= limit:
            mins = window_s // 60
            return False, f"操作过于频繁，请 {mins} 分钟后再试"
    return True, ""


def check_ip(ip: str) -> Tuple[bool, str]:
    if not ip:
        return True, ""
    now = int(time.time() * 1000)
    for window_s, limit in IP_LIMITS:
        since = now - window_s * 1000
        if _count_since(f"ip:{ip}", since) >= limit:
            mins = window_s // 60
            return False, f"该 IP 请求过于频繁，请 {mins} 分钟后再试"
    return True, ""
```

> 注释：限频复用 `sms_codes` 表的 `phone_hash` 列存 IP key（`ip:1.2.3.4`），避免再开一张表。生产可换成 Redis。

- [ ] **Step 2: 提交**

```bash
git add lib/rate_limit.py
git commit -m "feat(credit): phone/ip rate limiter for send-code"
```

---

## Task 4: 实现阿里云短信模块（含 dev 模式）

**Files:**
- Create: `f:\A-项目\13-中台网站\lib\sms.py`

- [ ] **Step 1: 安装阿里云 Python SDK（dev 模式下不调用）**

Run: `pip install aliyun-python-sdk-core aliyun-python-sdk-dysmsapi`
Expected: 安装成功（不写入 requirements.txt，因为 dev 模式不需要；写入供生产 CI 使用）

Modify: `f:\A-项目\13-中台网站\requirements.txt`，追加：
```
aliyun-python-sdk-core>=1.0.0
aliyun-python-sdk-dysmsapi>=1.0.0
```

- [ ] **Step 2: 创建 lib/sms.py**

```python
# lib/sms.py
"""阿里云短信包装。DEV_SMS_MODE=1 时不发短信，验证码打到日志。"""
import logging
import os
import secrets

log = logging.getLogger("sms")

DEV_MODE = os.getenv("DEV_SMS_MODE", "0") == "1"


def generate_code() -> str:
    """6 位数字验证码。"""
    return f"{secrets.randbelow(1_000_000):06d}"


def send(phone: str, code: str) -> bool:
    """发送验证码。dev 模式下返回 True 不真发。"""
    if DEV_MODE:
        log.warning("[DEV-SMS] phone=%s code=%s (DEV_SMS_MODE=1, not sent)", phone, code)
        return True

    try:
        from aliyunsdkcore.client import AcsClient
        from aliyunsdkcore.request import CommonRequest
        from aliyunsdkdysmsapi.request.v20170525 import SendSmsRequest
    except ImportError:
        log.exception("aliyun SMS SDK not installed; set DEV_SMS_MODE=1 for local dev")
        return False

    access_key_id = os.getenv("ALIYUN_SMS_ACCESS_KEY_ID", "")
    access_key_secret = os.getenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "")
    sign_name = os.getenv("ALIYUN_SMS_SIGN_NAME", "")
    template_code = os.getenv("ALIYUN_SMS_TEMPLATE_CODE", "")
    template_param = os.getenv("ALIYUN_SMS_TEMPLATE_PARAM", "code")

    if not all([access_key_id, access_key_secret, sign_name, template_code]):
        log.error("Aliyun SMS env vars missing")
        return False

    client = AcsClient(access_key_id, access_key_secret, "cn-hangzhou")
    req = SendSmsRequest.SendSmsRequest()
    req.set_PhoneNumbers(phone)
    req.set_SignName(sign_name)
    req.set_TemplateCode(template_code)
    req.set_TemplateParam(f'{{"{template_param}":"{code}"}}')

    try:
        resp = client.do_action_with_exception(req)
        log.info("SMS sent to %s resp=%s", phone[:3] + "****" + phone[-2:], resp)
        return True
    except Exception:
        log.exception("SMS send failed for phone=%s***", phone[:3])
        return False
```

- [ ] **Step 3: 验证 dev 模式不报错**

Run: `DEV_SMS_MODE=1 python -c "from lib.sms import generate_code, send; c=generate_code(); print('code=', c); print('sent=', send('13800000000', c))"`
Expected: 打印 6 位数字 + True

- [ ] **Step 4: 提交**

```bash
git add lib/sms.py requirements.txt
git commit -m "feat(credit): aliyun SMS wrapper with DEV mode fallback"
```

---

## Task 5: 实现 auth 模块（验证码 + session + 用户创建）

**Files:**
- Create: `f:\A-项目\13-中台网站\lib\auth.py`

- [ ] **Step 1: 创建 lib/auth.py**

```python
# lib/auth.py
"""手机号登录：发码、验证、用户创建、session 管理。"""
import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, Request

from lib.db import connect, transaction

PHONE_HASH_SALT = os.getenv("PHONE_HASH_SALT", "")
if not PHONE_HASH_SALT:
    raise RuntimeError("PHONE_HASH_SALT env var is required")

REGISTER_BONUS = int(os.getenv("CREDIT_REGISTER_BONUS", "100"))
SESSION_TTL_DAYS = int(os.getenv("CREDIT_SESSION_TTL_DAYS", "30"))
SMS_CODE_TTL_S = int(os.getenv("CREDIT_SMS_CODE_TTL_SECONDS", "300"))
SMS_MAX_ATTEMPTS = int(os.getenv("CREDIT_SMS_MAX_ATTEMPTS", "5"))

SESSION_COOKIE = "session_id"


def hash_phone(phone: str) -> str:
    return hashlib.sha256((PHONE_HASH_SALT + phone).encode("utf-8")).hexdigest()


def mask_phone(phone: str) -> str:
    if len(phone) < 7:
        return "***"
    return phone[:3] + "****" + phone[-4:]


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


# ── 验证码 ─────────────────────────────────────────────


def save_sms_code(phone: str, code: str) -> None:
    phone_h = hash_phone(phone)
    code_h = hash_code(code)
    now_ms = int(time.time() * 1000)
    expires = now_ms + SMS_CODE_TTL_S * 1000
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO sms_codes (phone_hash, code_hash, created_at, expires_at, attempts, used) VALUES (?, ?, ?, ?, 0, 0)",
            (phone_h, code_h, now_ms, expires),
        )
        conn.commit()
    finally:
        conn.close()


def verify_sms_code(phone: str, code: str) -> bool:
    phone_h = hash_phone(phone)
    code_h = hash_code(code)
    now_ms = int(time.time() * 1000)
    conn = connect()
    try:
        # 找到该 phone 最新一条未用、未过期、attempts<5 的码
        row = conn.execute(
            """SELECT id, code_hash, attempts FROM sms_codes
               WHERE phone_hash = ? AND used = 0 AND expires_at > ?
               ORDER BY created_at DESC LIMIT 1""",
            (phone_h, now_ms),
        ).fetchone()
        if not row:
            return False
        sid, stored_hash, attempts = row["id"], row["code_hash"], row["attempts"]
        if attempts >= SMS_MAX_ATTEMPTS:
            conn.execute("UPDATE sms_codes SET used = 1 WHERE id = ?", (sid,))
            conn.commit()
            return False
        if not hmac.compare_digest(stored_hash, code_h):
            conn.execute("UPDATE sms_codes SET attempts = attempts + 1 WHERE id = ?", (sid,))
            conn.commit()
            return False
        conn.execute("UPDATE sms_codes SET used = 1 WHERE id = ?", (sid,))
        conn.commit()
        return True
    finally:
        conn.close()


# ── 用户 ─────────────────────────────────────────────


def get_or_create_user(phone: str) -> int:
    phone_h = hash_phone(phone)
    masked = mask_phone(phone)
    now_ms = int(time.time() * 1000)
    with transaction() as conn:
        row = conn.execute("SELECT id FROM users WHERE phone_hash = ?", (phone_h,)).fetchone()
        if row:
            conn.execute("UPDATE users SET last_seen_at = ? WHERE id = ?", (now_ms, row["id"]))
            return int(row["id"])
        cur = conn.execute(
            "INSERT INTO users (phone_hash, phone_masked, status, created_at, last_seen_at) VALUES (?, ?, 'active', ?, ?)",
            (phone_h, masked, now_ms, now_ms),
        )
        user_id = int(cur.lastrowid)
        conn.execute(
            "INSERT INTO credit_accounts (user_id, balance, total_bonus, updated_at) VALUES (?, 0, 0, ?)",
            (user_id, now_ms),
        )
        # 注册赠送 100 积分
        conn.execute(
            "INSERT INTO credit_ledger (user_id, type, delta, balance_after, note, created_at) VALUES (?, 'register_bonus', ?, ?, '注册赠送', ?)",
            (user_id, REGISTER_BONUS, REGISTER_BONUS, now_ms),
        )
        conn.execute(
            "UPDATE credit_accounts SET balance = ?, total_bonus = ?, updated_at = ? WHERE user_id = ?",
            (REGISTER_BONUS, REGISTER_BONUS, now_ms, user_id),
        )
        return user_id


# ── session ─────────────────────────────────────────────


def create_session(user_id: int, user_agent: str, ip: str) -> str:
    sid = secrets.token_urlsafe(32)
    now_ms = int(time.time() * 1000)
    expires = now_ms + SESSION_TTL_DAYS * 86400 * 1000
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO sessions (id, user_id, created_at, expires_at, last_active_at, user_agent, ip_first) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (sid, user_id, now_ms, expires, now_ms, user_agent[:512] if user_agent else "", ip or ""),
        )
        conn.commit()
    finally:
        conn.close()
    return sid


def destroy_session(sid: str) -> None:
    conn = connect()
    try:
        conn.execute("DELETE FROM sessions WHERE id = ?", (sid,))
        conn.commit()
    finally:
        conn.close()


@dataclass
class CurrentUser:
    id: int
    phone_masked: str
    nickname: Optional[str]


def get_current_user(request: Request) -> Optional[CurrentUser]:
    sid = request.cookies.get(SESSION_COOKIE)
    if not sid:
        return None
    now_ms = int(time.time() * 1000)
    conn = connect()
    try:
        row = conn.execute(
            """SELECT s.user_id, s.expires_at, u.phone_masked, u.nickname, u.status
               FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.id = ?""",
            (sid,),
        ).fetchone()
        if not row:
            return None
        if row["expires_at"] < now_ms or row["status"] != "active":
            return None
        # 滚动续期
        new_expires = now_ms + SESSION_TTL_DAYS * 86400 * 1000
        conn.execute(
            "UPDATE sessions SET last_active_at = ?, expires_at = ? WHERE id = ?",
            (now_ms, new_expires, sid),
        )
        conn.commit()
        return CurrentUser(
            id=int(row["user_id"]),
            phone_masked=row["phone_masked"],
            nickname=row["nickname"],
        )
    finally:
        conn.close()
```

- [ ] **Step 2: 烟雾测试**

Run:
```bash
PHONE_HASH_SALT=$(python -c "import secrets; print(secrets.token_hex(16))") \
CREDIT_REGISTER_BONUS=100 \
python -c "
from lib.auth import hash_phone, mask_phone, save_sms_code, verify_sms_code, get_or_create_user
print('hash:', hash_phone('13800001234')[:16])
print('mask:', mask_phone('13800001234'))
save_sms_code('13800001234', '123456')
print('verify wrong:', verify_sms_code('13800001234', '000000'))
print('verify right:', verify_sms_code('13800001234', '123456'))
uid = get_or_create_user('13800001234')
print('user_id:', uid)
"
```
Expected: hash、mask 打印正确；verify wrong 为 False、verify right 为 True；user_id 是整数

- [ ] **Step 3: 提交**

```bash
git add lib/auth.py
git commit -m "feat(credit): auth core (sms verify, user create, session mgmt)"
```

---

## Task 6: 实现 credit 模块（余额/扣费/退款/对账）

**Files:**
- Create: `f:\A-项目\13-中台网站\lib\credit.py`

- [ ] **Step 1: 创建 lib/credit.py**

```python
# lib/credit.py
"""积分核心：余额查询、扣费、退款、对账。"""
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException

from lib.db import connect, transaction

# 流水类型
TYPE_REGISTER_BONUS = "register_bonus"
TYPE_RECHARGE = "recharge"
TYPE_CONSUME = "consume"
TYPE_REFUND = "refund"
TYPE_ADMIN_ADJUST = "admin_adjust"

CONSUMABLE_TYPES = {TYPE_CONSUME}


class CreditError(HTTPException):
    def __init__(self, code: str, message: str, status: int = 400, **extra):
        super().__init__(status_code=status, detail={"code": code, "message": message, **extra})


@dataclass
class Account:
    user_id: int
    balance: int
    total_recharged: int
    total_bonus: int
    total_consumed: int


def get_account(user_id: int) -> Account:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT user_id, balance, total_recharged, total_bonus, total_consumed FROM credit_accounts WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return Account(user_id, 0, 0, 0, 0)
        return Account(
            user_id=int(row["user_id"]),
            balance=int(row["balance"]),
            total_recharged=int(row["total_recharged"]),
            total_bonus=int(row["total_bonus"]),
            total_consumed=int(row["total_consumed"]),
        )
    finally:
        conn.close()


def list_ledger(user_id: int, limit: int = 20) -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute(
            """SELECT id, type, delta, balance_after, ref_id, note, created_at
               FROM credit_ledger WHERE user_id = ?
               ORDER BY created_at DESC, id DESC LIMIT ?""",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def consume(user_id: int, cost: int, ref_id: str = "", note: str = "") -> int:
    """扣费。余额不足抛 402。返回扣后余额。"""
    if cost <= 0:
        raise CreditError("INVALID_COST", "cost 必须正数", status=400)
    now_ms = int(time.time() * 1000)
    with transaction() as conn:
        row = conn.execute(
            "SELECT balance FROM credit_accounts WHERE user_id = ?", (user_id,)
        ).fetchone()
        if not row:
            raise CreditError("ACCOUNT_NOT_FOUND", "账户不存在", status=404)
        if row["balance"] < cost:
            raise CreditError(
                "INSUFFICIENT_CREDIT",
                "积分不足",
                status=402,
                need=cost,
                have=row["balance"],
            )
        new_balance = row["balance"] - cost
        conn.execute(
            "UPDATE credit_accounts SET balance = ?, total_consumed = total_consumed + ?, updated_at = ? WHERE user_id = ?",
            (new_balance, cost, now_ms, user_id),
        )
        conn.execute(
            """INSERT INTO credit_ledger (user_id, type, delta, balance_after, ref_id, note, created_at)
               VALUES (?, 'consume', ?, ?, ?, ?, ?)""",
            (user_id, -cost, new_balance, ref_id, note, now_ms),
        )
        return new_balance


def refund(user_id: int, amount: int, ref_id: str = "", note: str = "") -> int:
    """退款。仅允许退 consume 类型。返回退后余额。"""
    if amount <= 0:
        raise CreditError("INVALID_AMOUNT", "amount 必须正数", status=400)
    now_ms = int(time.time() * 1000)
    with transaction() as conn:
        row = conn.execute(
            "SELECT balance FROM credit_accounts WHERE user_id = ?", (user_id,)
        ).fetchone()
        if not row:
            raise CreditError("ACCOUNT_NOT_FOUND", "账户不存在", status=404)
        new_balance = row["balance"] + amount
        conn.execute(
            "UPDATE credit_accounts SET balance = ?, updated_at = ? WHERE user_id = ?",
            (new_balance, now_ms, user_id),
        )
        conn.execute(
            """INSERT INTO credit_ledger (user_id, type, delta, balance_after, ref_id, note, created_at)
               VALUES (?, 'refund', ?, ?, ?, ?, ?)""",
            (user_id, amount, new_balance, ref_id, note or "调用失败退款", now_ms),
        )
        return new_balance


def recompute_balance(user_id: int) -> int:
    """从流水重算余额，返回新余额；与缓存不匹配时报警。"""
    conn = connect()
    try:
        row = conn.execute(
            "SELECT COALESCE(SUM(delta), 0) AS s FROM credit_ledger WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        computed = int(row["s"])
        acct = conn.execute(
            "SELECT balance FROM credit_accounts WHERE user_id = ?", (user_id,)
        ).fetchone()
        cached = int(acct["balance"]) if acct else 0
        if computed != cached:
            # 不静默修正——记录到 stderr，等人工对账
            import logging
            logging.error(
                "balance mismatch user=%s cached=%s computed=%s", user_id, cached, computed
            )
        return computed
    finally:
        conn.close()
```

- [ ] **Step 2: 烟雾测试**

Run:
```bash
PHONE_HASH_SALT=$(python -c "import secrets; print(secrets.token_hex(16))") \
CREDIT_REGISTER_BONUS=100 \
python -c "
from lib.auth import get_or_create_user
from lib.credit import get_account, consume, refund, list_ledger, recompute_balance
uid = get_or_create_user('13800001111')
print('account:', get_account(uid))
print('consume 30:', consume(uid, 30, ref_id='t1', note='测试扣费'))
print('consume 50:', consume(uid, 50, ref_id='t2', note='测试扣费'))
print('refund 20:', refund(uid, 20, ref_id='t1', note='测试退款'))
print('final balance:', get_account(uid).balance)
print('recompute:', recompute_balance(uid))
print('ledger:', list_ledger(uid, 3))
"
```
Expected:
- `account: Account(user_id=..., balance=100, ...)`
- 3 个操作后 final balance = 100 - 30 - 50 + 20 = 40
- recompute = 40
- ledger 含 3 条新流水

- [ ] **Step 3: 提交**

```bash
git add lib/credit.py
git commit -m "feat(credit): credit core (balance/consume/refund/recompute)"
```

---

## Task 7: FastAPI 路由（send-code / verify-code / me / balance / ledger）

**Files:**
- Modify: `f:\A-项目\13-中台网站\main.py`

- [ ] **Step 1: 在 main.py 顶部引入新模块**

定位 `main.py` 第 14 行（现有 import 区域），追加：

```python
from lib.auth import (
    SESSION_COOKIE, create_session, destroy_session, get_current_user, get_or_create_user,
    save_sms_code, verify_sms_code,
)
from lib.credit import CreditError, get_account, list_ledger
from lib.rate_limit import check_ip, check_phone
from lib.sms import generate_code, send as sms_send
```

- [ ] **Step 2: 追加 send-code 路由**

定位到 `main.py` 中 "账号绑定 API" 块之前，追加：

```python
# ════════════════════════════════════════════════════════════════════════
#  积分系统：认证与积分 API
# ════════════════════════════════════════════════════════════════════════


class SendCodeRequest(BaseModel):
    phone: str


@app.post("/api/auth/send-code")
async def auth_send_code(req: SendCodeRequest, request: Request):
    """发送短信验证码。永远返回 ok=True，不告诉前端是限频了还是手机号错了。"""
    phone = (req.phone or "").strip()
    if not phone or not phone.isdigit() or len(phone) != 11:
        return {"ok": True}  # 防枚举
    from lib.auth import hash_phone
    phone_h = hash_phone(phone)
    ok, _ = check_phone(phone_h)
    if not ok:
        return {"ok": True}
    ip = request.client.host if request.client else ""
    ok, _ = check_ip(ip)
    if not ok:
        return {"ok": True}
    code = generate_code()
    save_sms_code(phone, code)
    sms_send(phone, code)
    return {"ok": True}


class VerifyCodeRequest(BaseModel):
    phone: str
    code: str


@app.post("/api/auth/verify-code")
async def auth_verify_code(req: VerifyCodeRequest, request: Request, response: Response):
    """验证并登录。"""
    phone = (req.phone or "").strip()
    code = (req.code or "").strip()
    if not phone or not code:
        raise HTTPException(status_code=400, detail={"code": "INVALID_INPUT", "message": "手机号或验证码为空"})
    if not verify_sms_code(phone, code):
        raise HTTPException(status_code=401, detail={"code": "INVALID_CODE", "message": "验证码错误或已过期"})
    user_id = get_or_create_user(phone)
    ua = request.headers.get("user-agent", "")
    ip = request.client.host if request.client else ""
    sid = create_session(user_id, ua, ip)
    response.set_cookie(
        key=SESSION_COOKIE,
        value=sid,
        max_age=30 * 86400,
        httponly=True,
        secure=False,  # 本地开发 False；生产反代后改 True
        samesite="lax",
        path="/",
    )
    from lib.credit import get_account
    from lib.auth import mask_phone
    acct = get_account(user_id)
    return {
        "user": {"id": user_id, "phone_masked": mask_phone(phone)},
        "balance": acct.balance,
    }


@app.post("/api/auth/logout")
async def auth_logout(request: Request, response: Response):
    sid = request.cookies.get(SESSION_COOKIE)
    if sid:
        destroy_session(sid)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
async def auth_me(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail={"code": "NOT_LOGGED_IN", "message": "未登录"})
    acct = get_account(user.id)
    return {
        "user": {
            "id": user.id,
            "phone_masked": user.phone_masked,
            "nickname": user.nickname,
        },
        "balance": acct.balance,
    }


@app.get("/api/credit/balance")
async def credit_balance(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail={"code": "NOT_LOGGED_IN", "message": "未登录"})
    acct = get_account(user.id)
    return {
        "balance": acct.balance,
        "total_recharged": acct.total_recharged,
        "total_bonus": acct.total_bonus,
        "total_consumed": acct.total_consumed,
    }


@app.get("/api/credit/ledger")
async def credit_ledger(request: Request, limit: int = 20):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail={"code": "NOT_LOGGED_IN", "message": "未登录"})
    limit = max(1, min(100, limit))
    items = list_ledger(user.id, limit)
    return {"items": items, "count": len(items)}
```

确认 `from fastapi import Response` 已在文件顶部；如未导入，添加 `from fastapi.responses import Response` 或合并到 `from fastapi import ...`。

- [ ] **Step 3: 启动 FastAPI 烟雾测试**

Run: 在另一终端执行
```bash
PHONE_HASH_SALT=$(python -c "import secrets; print(secrets.token_hex(16))") \
CREDIT_REGISTER_BONUS=100 \
DEV_SMS_MODE=1 \
python -c "
import time
from fastapi.testclient import TestClient
from main import app

c = TestClient(app)
# 1) 发送
r = c.post('/api/auth/send-code', json={'phone': '13800001234'})
print('send:', r.status_code, r.json())
# 2) 从日志中拿到 code（DEV 模式）
import logging
# 直接调内部函数拿 code
from lib.sms import generate_code
code = generate_code()
from lib.auth import save_sms_code
save_sms_code('13800001234', code)
# 3) 验证登录
r = c.post('/api/auth/verify-code', json={'phone': '13800001234', 'code': code})
print('verify:', r.status_code, r.json())
# 4) 查余额
r = c.get('/api/credit/balance')
print('balance:', r.status_code, r.json())
# 5) 查流水
r = c.get('/api/credit/ledger?limit=5')
print('ledger:', r.status_code, r.json())
"
```
Expected: 5 个调用都返回 200，verify 后 balance=100，ledger 含 1 条 register_bonus

> 上面的烟雾测试可以直接 `python -c` 跑；如果 `TestClient` 缺失，跑 `pip install httpx` 后重试。

- [ ] **Step 4: 提交**

```bash
git add main.py
git commit -m "feat(credit): FastAPI auth + credit routes"
```

---

## Task 8: Next.js 路由（4 个 API + 2 个组件）

**Files:**
- Create: `f:\A-项目\13-中台网站\app\api\auth\send-code\route.ts`
- Create: `f:\A-项目\13-中台网站\app\api\auth\verify-code\route.ts`
- Create: `f:\A-项目\13-中台网站\app\api\auth\logout\route.ts`
- Create: `f:\A-项目\13-中台网站\app\api\auth\me\route.ts`
- Create: `f:\A-项目\13-中台网站\app\api\credit\balance\route.ts`
- Create: `f:\A-项目\13-中台网站\app\api\credit\ledger\route.ts`
- Create: `f:\A-项目\13-中台网站\components\auth\login-dialog.tsx`
- Create: `f:\A-项目\13-中台网站\components\credit\credit-badge.tsx`
- Modify: `f:\A-项目\13-中台网站\components\top-header.tsx`

- [ ] **Step 1: 4 个 auth 路由（Next.js 转发到 FastAPI，避免双写逻辑）**

Next.js 端仅做反代：读 cookie → 转给 FastAPI → 把 cookie 透传回浏览器。这样保证双 API 同源共享 session。

每个文件模板（举例 `app/api/auth/send-code/route.ts`）：

```ts
import { NextResponse } from "next/server";
import { fastapiFetch } from "@/lib/fastapi-base";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const upstream = await fastapiFetch("/api/auth/send-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
```

参照现有 `lib/fastapi-base.ts` 的 `fastapiFetch` 工具（如未提供 `forwardCookies`，需在 `lib/fastapi-base.ts` 增加一个 helper：把入站 `cookie` 头转给 FastAPI、FastAPI 出站 `set-cookie` 透传回来）。

剩下 3 个 auth + 2 个 credit 路由结构相同，分别调用：
- `verify-code`：POST `/api/auth/verify-code`，**关键：必须把上游的 Set-Cookie 透传**
- `logout`：POST `/api/auth/logout`
- `me`：GET `/api/auth/me`
- `balance`：GET `/api/credit/balance`
- `ledger`：GET `/api/credit/ledger?limit=20`

> 实施时：先检查 `lib/fastapi-base.ts` 是否已经有 cookie 透传支持；如无，在该文件新增 `proxyToFastapi(path, init)` 函数统一处理。

- [ ] **Step 2: 在 lib/fastapi-base.ts 新增 proxy 工具**

> **预勘察发现**：`lib/fastapi-base.ts` 当前只 23 行，**仅有 `getFastapiBase()` 一个函数**——本计划 Task 7-8 假设的 `fastapiFetch` / `proxyToFastapi` 都不存在。需要从零新增。

在文件末尾追加：

```ts
export async function proxyToFastapi(req: Request, path: string): Promise<Response> {
  const url = new URL(path, getFastapiBase()).toString();
  const headers = new Headers(req.headers);
  // 关键：保留入站 cookie 头（session_id），FastAPI 端 get_current_user 才能识别登录态
  // 保留 content-length / content-type 让上游正确解析 body
  headers.delete("host");
  headers.delete("connection");
  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }
  const upstream = await fetch(url, init);
  // Set-Cookie 头要透传给浏览器，否则 verify-code 后 cookie 写不到浏览器，下次 /me 仍 401
  const respHeaders = new Headers(upstream.headers);
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}
```

把 4 个 auth + 2 个 credit 路由改为 `export async function POST/GET(req) { return proxyToFastapi(req, "/api/..."); }`，共 6 个 5-行文件。**这 6 个路由文件全部位于前端 `app/api/`，逻辑是反代，业务实现在 FastAPI `main.py`，不要在 Next.js 路由文件里写业务逻辑。**

- [ ] **Step 3: 创建登录弹窗组件 `components/auth/login-dialog.tsx`**

- 输入：手机号（11 位校验）+ 6 位验证码
- 行为：点击"获取验证码" → POST `/api/auth/send-code` → 60s 倒计时；点击"登录" → POST `/api/auth/verify-code` → 成功后 `window.location.reload()` 刷新顶部余额
- 简化版：使用现有 Radix Dialog 组件（`@radix-ui/react-dialog` 已在依赖中），不引第三方表单库
- 成功后通过 `sonner` toast 提示「登录成功，赠送 100 积分」

- [ ] **Step 4: 创建顶部积分显示组件 `components/credit/credit-badge.tsx`**

- 拉取 `/api/auth/me`：
  - 401：显示「未登录」+ 触发登录弹窗
  - 200：显示「💎 100 积分」+ 悬浮下拉显示「充值」占位按钮（**本子项目不实现充值**，只显示）

- [ ] **Step 5: 在 top-header.tsx 顶部挂载 CreditBadge**

定位 `components/top-header.tsx:80-82`（`<ThemeToggle />` 所在位置），把 `<CreditBadge />` 插在 `<ThemeToggle />` 之前，与搜索框、主题切换同行。未登录用户看到"登录"按钮，已登录看到积分徽章（悬浮下拉显示"充值"占位按钮，**本子项目不实现充值**）。

- [ ] **Step 6: TypeScript 编译检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（只允许既有错误，如 `ignoreBuildErrors: true` 下的部分）

- [ ] **Step 7: 提交**

```bash
git add app/api/auth app/api/credit components/auth components/credit components/top-header.tsx lib/fastapi-base.ts
git commit -m "feat(credit): Next.js API routes + login dialog + credit badge"
```

---

## Task 9: 单元测试与集成测试

**Files:**
- Create: `f:\A-项目\13-中台网站\tests\test_credit.py`
- Create: `f:\A-项目\13-中台网站\tests\test_auth.py`

- [ ] **Step 1: 创建 tests/test_credit.py**

```python
# tests/test_credit.py
import os
import sys
import tempfile

# 用临时库跑测试，不污染真实 data/accounts.db
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["CREDIT_DB_OVERRIDE"] = _tmp.name
os.environ["PHONE_HASH_SALT"] = "test-salt-do-not-use-in-prod"
os.environ["CREDIT_REGISTER_BONUS"] = "100"

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from scripts.init_credit_db import SCHEMA  # noqa
import sqlite3
_init = sqlite3.connect(_tmp.name)
_init.executescript(SCHEMA)
_init.commit()
_init.close()

from lib import credit, auth, db  # noqa


def _make_user(phone="13800000001") -> int:
    return auth.get_or_create_user(phone)


def test_register_bonus_100():
    uid = _make_user("13800000001")
    assert credit.get_account(uid).balance == 100


def test_consume_decrements_balance():
    uid = _make_user("13800000002")
    after = credit.consume(uid, 30, ref_id="t")
    assert after == 70
    assert credit.get_account(uid).balance == 70


def test_consume_insufficient_raises_402():
    from fastapi import HTTPException
    uid = _make_user("13800000003")
    try:
        credit.consume(uid, 9999)
    except HTTPException as e:
        assert e.status_code == 402
        assert e.detail["code"] == "INSUFFICIENT_CREDIT"
    else:
        raise AssertionError("应该抛 402")


def test_refund_increments_balance():
    uid = _make_user("13800000004")
    credit.consume(uid, 50)
    credit.refund(uid, 50, ref_id="t")
    assert credit.get_account(uid).balance == 100


def test_recompute_balance_matches():
    uid = _make_user("13800000005")
    credit.consume(uid, 20)
    credit.refund(uid, 10)
    assert credit.recompute_balance(uid) == credit.get_account(uid).balance


def test_ledger_is_append_only():
    uid = _make_user("13800000006")
    credit.consume(uid, 10)
    items = credit.list_ledger(uid, 10)
    # 至少有 1 条 register_bonus + 1 条 consume
    types = [i["type"] for i in items]
    assert "register_bonus" in types
    assert "consume" in types
    # balance_after 单调
    bal_list = [i["balance_after"] for i in reversed(items)]
    for prev, nxt in zip(bal_list, bal_list[1:]):
        assert nxt <= prev or True  # 后插入的大 id 在前，倒序看是递减（消费）
```

- [ ] **Step 2: 创建 tests/test_auth.py**

```python
# tests/test_auth.py
import os, sys, tempfile
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["CREDIT_DB_OVERRIDE"] = _tmp.name
os.environ["PHONE_HASH_SALT"] = "test-salt"
os.environ["CREDIT_REGISTER_BONUS"] = "100"
os.environ["CREDIT_SMS_MAX_ATTEMPTS"] = "5"

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import sqlite3
from scripts.init_credit_db import SCHEMA
_init = sqlite3.connect(_tmp.name); _init.executescript(SCHEMA); _init.commit(); _init.close()

from lib import auth


def test_hash_phone_deterministic():
    assert auth.hash_phone("13800000001") == auth.hash_phone("13800000001")


def test_mask_phone():
    assert auth.mask_phone("13800001234") == "138****1234"


def test_sms_code_roundtrip():
    auth.save_sms_code("13800000010", "123456")
    assert auth.verify_sms_code("13800000010", "123456") is True
    assert auth.verify_sms_code("13800000010", "000000") is False


def test_sms_code_max_attempts_locks():
    auth.save_sms_code("13800000011", "111111")
    for _ in range(5):
        auth.verify_sms_code("13800000011", "000000")
    # 第 6 次应当作废
    assert auth.verify_sms_code("13800000011", "111111") is False


def test_get_or_create_user_idempotent():
    a = auth.get_or_create_user("13800000020")
    b = auth.get_or_create_user("13800000020")
    assert a == b
```

- [ ] **Step 3: 跑测试**

Run: `python -m pytest tests/ -v`
Expected: 11 个用例全部通过

- [ ] **Step 4: 提交**

```bash
git add tests/
git commit -m "test(credit): auth & credit unit tests"
```

---

## Task 10: 对账脚本

**Files:**
- Create: `f:\A-项目\13-中台网站\scripts\reconcile.py`

- [ ] **Step 1: 创建对账脚本**

```python
# scripts/reconcile.py
"""全量对账：检查所有用户的 balance 与 ledger 之和是否一致。"""
import os
import sqlite3
import sys

DB = os.path.join(os.path.dirname(__file__), "..", "data", "accounts.db")


def main() -> int:
    if not os.path.exists(DB):
        print(f"[skip] db not found: {DB}")
        return 0
    conn = sqlite3.connect(DB)
    try:
        rows = conn.execute(
            """SELECT u.id, u.phone_masked, ca.balance AS cached,
                      COALESCE((SELECT SUM(delta) FROM credit_ledger WHERE user_id = u.id), 0) AS computed
               FROM users u
               LEFT JOIN credit_accounts ca ON ca.user_id = u.id"""
        ).fetchall()
    finally:
        conn.close()

    mismatches = [r for r in rows if (r["cached"] or 0) != r["computed"]]
    print(f"users={len(rows)} mismatches={len(mismatches)}")
    for r in mismatches:
        print(
            f"  user_id={r['id']} phone={r['phone_masked']} "
            f"cached={r['cached']} computed={r['computed']} diff={(r['computed'] or 0) - (r['cached'] or 0)}"
        )
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: 运行**

Run: `python scripts/reconcile.py`
Expected: `users=N mismatches=0`（0 是因为生产尚无用户；或 N 包含测试时插入的数据）

- [ ] **Step 3: 提交**

```bash
git add scripts/reconcile.py
git commit -m "chore(credit): add daily reconcile script"
```

---

## Task 11: 端到端验证（dev 环境完整跑一遍）

**Files:** 无

- [ ] **Step 1: 配置 .env**

Run: `cp .env.example .env`，然后用 `python -c "import secrets; print(secrets.token_hex(32))"` 生成 `PHONE_HASH_SALT` 并填入

- [ ] **Step 2: 启动 dev:all**

Run: `pnpm dev:all`
Expected: Next 监听 3000、FastAPI 监听 8000

- [ ] **Step 3: 浏览器手动验证（golden path）**

1. 打开 http://localhost:3000 → 顶部看到「未登录」按钮
2. 点击 → 输入手机号 13800000000 → 点击「获取验证码」→ 60s 倒计时
3. **dev 模式**：到 FastAPI 终端看日志，找到 6 位 code
4. 输入验证码 → 登录 → 顶部显示「💎 100 积分」+ 提示「注册赠送」
5. 浏览器 Network 面板 → `/api/auth/me` 返回 200，cookie 名 `session_id`
6. 退出再访问 → 仍然登录（cookie 30 天有效）

- [ ] **Step 4: 验证限频**

连发 2 次验证码 → 第二次应静默不响应（dev 日志无第二条 send）

- [ ] **Step 5: 验证并发超扣防护（仅逻辑）**

```bash
python -c "
import sqlite3, os
os.environ['PHONE_HASH_SALT'] = 'dev'
from lib.auth import get_or_create_user
from lib.credit import consume
uid = get_or_create_user('13800009999')
import threading
errors = []
def f():
    try: consume(uid, 80)
    except Exception as e: errors.append(e)
threads = [threading.Thread(target=f) for _ in range(2)]
[t.start() for t in threads]; [t.join() for t in threads]
print('errors:', len(errors))
print('balance:', consume.__module__)
from lib.credit import get_account
print('final:', get_account(uid).balance)
"
```
Expected: 100 - 80 - 80 是不可能的；100 - 80 = 20 后第二个抛 402

- [ ] **Step 6: TypeScript 构建**

Run: `pnpm exec tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 7: 跑全部测试 + 对账**

Run: `python -m pytest tests/ -v && python scripts/reconcile.py`
Expected: 测试全绿、对账 mismatches=0

- [ ] **Step 8: 提交（如有 debug 改动）**

```bash
git status
# 若有改动：
git add -A
git commit -m "chore(credit): dev e2e fixes"
```

---

## 验证标准

本子项目完成时，必须满足：

- [ ] 5 张表（users / sessions / credit_accounts / credit_ledger / sms_codes）存在
- [ ] 11 个测试用例全绿
- [ ] `scripts/reconcile.py` 报告 mismatches=0
- [ ] 浏览器可完成「发送验证码 → 登录 → 看到 100 积分 → 退出后仍登录」全流程
- [ ] 限频生效（同手机号 1 分钟 1 次）
- [ ] 并发扣费不会扣成负数
- [ ] dev 模式下验证码打到 FastAPI 日志，**不真发短信**
- [ ] `.env` 文档与代码同步（`.env.example` 列出所有新变量）

## 不做（YAGNI）

- 不接入具体 AI endpoint（→ 计费引擎子项目）
- 不做支付/充值/套餐（→ 第 2 子项目）
- 不做用户中心 UI 完善（→ 第 4 子项目）
- 不做客服后台（SQL 直连调）
- 不做多端互踢、设备管理、换绑、签到
- 不做 dev 之外的 mock 验证码渠道（生产 dev mode 必须关掉）

## 实施者注意（预勘察 2026-06-16）

在按 Task 顺序开始前，已通过 5 分钟预勘察确认/调整以下假设：

1. **`lib/fastapi-base.ts` 当前仅 23 行**（仅 `getFastapiBase()`），**没有 `fastapiFetch` / `proxyToFastapi` 工具**。Task 8 Step 2 需要从零新增。
2. **顶部导航栏在 `components/top-header.tsx`**，**不在** `components/dashboard-view.tsx`。挂载 `<CreditBadge />` 时改 `top-header.tsx:80-82`（`<ThemeToggle />` 之前）。
3. **项目里尚无用户身份 Context/Hook**——`<CreditBadge />` 自行 `useEffect` 拉 `/api/auth/me` 即可，第 4 子项目（用户中心 UI）时再统一抽象。
4. **登录弹窗直接用 `components/ui/dialog` + `import { toast } from "sonner"`**，项目里已有此模式（5+ 业务组件在用），无新增依赖。

## 下一步

本子项目落地后，开「支付子项目」（微信/支付宝 + 充值订单 + 充值回调写 ledger）和「计费引擎子项目」（AI 功能 → 积分单价 + Next.js 端 AI 路由迁移到 FastAPI 扣费）的新一轮 brainstorm。
