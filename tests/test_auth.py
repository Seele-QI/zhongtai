import os
import sqlite3
import sys
import tempfile

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["CREDIT_DB_OVERRIDE"] = _tmp.name
os.environ["PHONE_HASH_SALT"] = "test-salt"
os.environ["CREDIT_REGISTER_BONUS"] = "100"
os.environ["CREDIT_SMS_MAX_ATTEMPTS"] = "5"

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from scripts.init_credit_db import SCHEMA

_init = sqlite3.connect(_tmp.name)
_init.executescript(SCHEMA)
_init.commit()
_init.close()

from lib import auth  # noqa: E402


def test_hash_phone_deterministic():
    assert auth.hash_phone("13800000001") == auth.hash_phone("13800000001")


def test_hash_phone_differs_by_salt():
    a = auth.hash_phone("13800000001")
    assert a == auth.hash_phone("13800000001")
    assert len(a) == 64  # sha256 hex


def test_mask_phone_standard():
    assert auth.mask_phone("13800001234") == "138****1234"


def test_mask_phone_short():
    assert auth.mask_phone("12345") == "***"


def test_sms_code_roundtrip():
    auth.save_sms_code("13800000010", "123456")
    assert auth.verify_sms_code("13800000010", "123456") is True
    assert auth.verify_sms_code("13800000010", "000000") is False


def test_sms_code_max_attempts_locks():
    auth.save_sms_code("13800000011", "111111")
    for _ in range(5):
        auth.verify_sms_code("13800000011", "000000")
    assert auth.verify_sms_code("13800000011", "111111") is False


def test_sms_code_used_invalidated():
    auth.save_sms_code("13800000012", "222222")
    assert auth.verify_sms_code("13800000012", "222222") is True
    # 第二次相同 code 应失败（已 used）
    assert auth.verify_sms_code("13800000012", "222222") is False


def test_get_or_create_user_idempotent():
    a = auth.get_or_create_user("13800000020")
    b = auth.get_or_create_user("13800000020")
    assert a == b


def test_get_or_create_user_registers_bonus():
    uid = auth.get_or_create_user("13800000030")
    from lib.credit import get_account
    assert get_account(uid).balance == 100
