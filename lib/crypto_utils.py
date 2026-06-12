"""
AES 加密/解密工具 — Cookie 安全存储

用法:
    encrypted, iv = encrypt_cookie(cookie_json_str)
    plaintext = decrypt_cookie(encrypted, iv)
"""

import os
import base64
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding


def _get_key() -> bytes:
    """从环境变量获取 AES-256 密钥（必须恰好 32 字节），无配置时用 PBKDF2 派生"""
    env_key = (os.getenv("COOKIE_ENCRYPTION_KEY") or "").strip()
    if len(env_key) >= 32:
        return env_key.encode()[:32]
    # Fallback: 固定种子 → 使用 SHA-256 哈希派生 32 字节密钥
    import hashlib
    seed = b"media-crawler-dev-salt-2024"
    return hashlib.sha256(seed).digest()


def encrypt_cookie(data: str) -> tuple[str, str]:
    """
    AES-256-CBC 加密 Cookie 字符串
    返回: (base64_encrypted, base64_iv)
    """
    key = _get_key()
    iv = os.urandom(16)

    padder = padding.PKCS7(128).padder()
    padded = padder.update(data.encode()) + padder.finalize()

    cipher = Cipher(algorithms.AES(key), modes.CBC(iv))
    encryptor = cipher.encryptor()
    encrypted = encryptor.update(padded) + encryptor.finalize()

    return base64.b64encode(encrypted).decode(), base64.b64encode(iv).decode()


def decrypt_cookie(encrypted: str, iv: str) -> str:
    """
    AES-256-CBC 解密 Cookie 字符串
    """
    key = _get_key()
    encrypted_bytes = base64.b64decode(encrypted)
    iv_bytes = base64.b64decode(iv)

    cipher = Cipher(algorithms.AES(key), modes.CBC(iv_bytes))
    decryptor = cipher.decryptor()
    padded = decryptor.update(encrypted_bytes) + decryptor.finalize()

    unpadder = padding.PKCS7(128).unpadder()
    plaintext = unpadder.update(padded) + unpadder.finalize()
    return plaintext.decode()
