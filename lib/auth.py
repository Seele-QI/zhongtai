"""手机号登录：发码、验证、用户创建、session 管理。"""
import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass
from typing import Optional

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
    phone_masked: str
    nickname: Optional[str]


def get_current_user(request) -> Optional[CurrentUser]:
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
