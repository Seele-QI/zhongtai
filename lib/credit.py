"""积分核心：余额查询、扣费、退款、对账。"""
import logging
import time
from dataclasses import dataclass

from fastapi import HTTPException

from lib.db import connect, transaction

TYPE_REGISTER_BONUS = "register_bonus"
TYPE_RECHARGE = "recharge"
TYPE_CONSUME = "consume"
TYPE_REFUND = "refund"
TYPE_ADMIN_ADJUST = "admin_adjust"


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
            logging.error(
                "balance mismatch user=%s cached=%s computed=%s", user_id, cached, computed
            )
        return computed
    finally:
        conn.close()
