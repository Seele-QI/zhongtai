import os
import sqlite3
import sys
import tempfile

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["CREDIT_DB_OVERRIDE"] = _tmp.name
os.environ["PHONE_HASH_SALT"] = "test-salt-do-not-use-in-prod"
os.environ["CREDIT_REGISTER_BONUS"] = "100"

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from scripts.init_credit_db import SCHEMA

_init = sqlite3.connect(_tmp.name)
_init.executescript(SCHEMA)
_init.commit()
_init.close()

from lib import credit, auth  # noqa: E402


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
    raised = False
    try:
        credit.consume(uid, 9999)
    except HTTPException as e:
        assert e.status_code == 402
        assert e.detail["code"] == "INSUFFICIENT_CREDIT"
        raised = True
    assert raised, "应该抛 402"


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


def test_ledger_contains_bonus_and_consume():
    uid = _make_user("13800000006")
    credit.consume(uid, 10)
    items = credit.list_ledger(uid, 10)
    types = {i["type"] for i in items}
    assert "register_bonus" in types
    assert "consume" in types


def test_consume_zero_or_negative_raises():
    uid = _make_user("13800000007")
    for bad in (0, -5):
        raised = False
        try:
            credit.consume(uid, bad)
        except Exception:
            raised = True
        assert raised, f"cost={bad} 应该抛"


def test_concurrent_consume_never_negative():
    import threading
    uid = _make_user("13800000008")
    initial = credit.get_account(uid).balance
    errors = []

    def worker():
        try:
            credit.consume(uid, 80)
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    final = credit.get_account(uid).balance
    assert final >= 0
    # 两个 worker 各自想扣 80；一个成功，一个抛 402
    assert initial - final == 80 or len(errors) == 1
