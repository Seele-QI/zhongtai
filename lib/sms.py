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
