"""邮箱 Magic Link 登录：发链接、验证 token、用户创建、session 管理。"""
import hashlib
import hmac
import os
import secrets
import sys
import time
from dataclasses import dataclass
from typing import Optional

from lib.db import connect, transaction

EMAIL_HASH_SALT = os.getenv("EMAIL_HASH_SALT", "")
if not EMAIL_HASH_SALT:
    if os.getenv("DEV_EMAIL_MODE", "0") == "1" or "--reload" in sys.argv:
        EMAIL_HASH_SALT = "dev-email-hash-salt"
    else:
        raise RuntimeError("EMAIL_HASH_SALT env var is required")

REGISTER_BONUS = int(os.getenv("CREDIT_REGISTER_BONUS", "100"))
SESSION_TTL_DAYS = int(os.getenv("CREDIT_SESSION_TTL_DAYS", "30"))
EMAIL_TOKEN_TTL_S = int(os.getenv("CREDIT_EMAIL_TOKEN_TTL_SECONDS", "900"))

SESSION_COOKIE = "session_id"


def hash_email(email: str) -> str:
    return hashlib.sha256((EMAIL_HASH_SALT + email.lower().strip()).encode("utf-8")).hexdigest()


def mask_email(email: str) -> str:
    """f**@gmail.com 风格脱敏。"""
    email = email.strip()
    if "@" not in email:
        return "***"
    local, _, domain = email.partition("@")
    if not local:
        return "***@" + domain
    if len(local) <= 2:
        masked_local = local[0] + "*"
    else:
        masked_local = local[0] + "**" + local[-1]
    return masked_local + "@" + domain


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def save_email_token(email: str, token: str) -> None:
    email_h = hash_email(email)
    token_h = hash_token(token)
    masked = mask_email(email)
    now_ms = int(time.time() * 1000)
    expires = now_ms + EMAIL_TOKEN_TTL_S * 1000
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO email_tokens (email_hash, email_masked, token_hash, created_at, expires_at, used, used_at) VALUES (?, ?, ?, ?, ?, 0, NULL)",
            (email_h, masked, token_h, now_ms, expires),
        )
        conn.commit()
    finally:
        conn.close()


def consume_email_token(token: str) -> Optional[dict]:
    """校验 token。返回 {'email_hash': ..., 'email_masked': ...} 或 None。"""
    token_h = hash_token(token)
    now_ms = int(time.time() * 1000)
    conn = connect()
    try:
        row = conn.execute(
            """SELECT id, email_hash, email_masked FROM email_tokens
               WHERE token_hash = ? AND used = 0 AND expires_at > ?
               ORDER BY created_at DESC LIMIT 1""",
            (token_h, now_ms),
        ).fetchone()
        if not row:
            return None
        conn.execute(
            "UPDATE email_tokens SET used = 1, used_at = ? WHERE id = ?",
            (now_ms, row["id"]),
        )
        conn.commit()
        return {"email_hash": row["email_hash"], "email_masked": row["email_masked"]}
    finally:
        conn.close()


def get_or_create_user_by_hash(email_hash: str, email_masked: str) -> int:
    """通过 email_hash 创建或获取用户。email 明文不传进来——保持 hash 单向性。"""
    now_ms = int(time.time() * 1000)
    with transaction() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE email_hash = ?", (email_hash,)
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE users SET last_seen_at = ? WHERE id = ?", (now_ms, row["id"])
            )
            return int(row["id"])
        cur = conn.execute(
            "INSERT INTO users (email_hash, email_masked, status, created_at, last_seen_at) VALUES (?, ?, 'active', ?, ?)",
            (email_hash, email_masked, now_ms, now_ms),
        )
        user_id = int(cur.lastrowid)
        conn.execute(
            "INSERT INTO credit_accounts (user_id, balance, total_bonus, updated_at) VALUES (?, 0, 0, ?)",
            (user_id, now_ms),
        )
        conn.execute(
            "INSERT INTO credit_ledger (user_id, type, delta, balance_after, note, created_at) VALUES (?, 'register_bonus', ?, ?, '注册赠送', ?)",
            (user_id, REGISTER_BONUS, REGISTER_BONUS, now_ms),
        )
        conn.execute(
            "UPDATE credit_accounts SET balance = ?, total_bonus = ?, updated_at = ? WHERE user_id = ?",
            (REGISTER_BONUS, REGISTER_BONUS, now_ms, user_id),
        )
        return user_id


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
    email_masked: str
    nickname: Optional[str]


def get_current_user(request) -> Optional[CurrentUser]:
    sid = request.cookies.get(SESSION_COOKIE)
    if not sid:
        return None
    now_ms = int(time.time() * 1000)
    conn = connect()
    try:
        row = conn.execute(
            """SELECT s.user_id, s.expires_at, u.email_masked, u.nickname, u.status
               FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.id = ?""",
            (sid,),
        ).fetchone()
        if not row:
            return None
        if row["expires_at"] < now_ms or row["status"] != "active":
            return None
        new_expires = now_ms + SESSION_TTL_DAYS * 86400 * 1000
        conn.execute(
            "UPDATE sessions SET last_active_at = ?, expires_at = ? WHERE id = ?",
            (now_ms, new_expires, sid),
        )
        conn.commit()
        return CurrentUser(
            id=int(row["user_id"]),
            email_masked=row["email_masked"],
            nickname=row["nickname"],
        )
    finally:
        conn.close()