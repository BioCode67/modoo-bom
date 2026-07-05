"""구조적 로깅 설정 — 출시용. print() 대신 표준 logging으로 레벨·시각·모듈을 남긴다.

원칙(개인정보 보호): 프로필·이름·연락처 등 PII는 로그에 남기지 않는다(에러 메시지·상태만).
LOG_LEVEL 환경변수로 조정(기본 INFO). 클라우드(Render 등) stdout 캡처와 호환.
"""
import logging
import os
import sys

_CONFIGURED = False


def setup_logging() -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        fmt="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%H:%M:%S",
    ))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(getattr(logging, level, logging.INFO))
    # 소음 큰 서드파티 로거는 한 단계 낮춘다
    for noisy in ("httpx", "httpcore", "urllib3", "chromadb", "sentence_transformers"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """모듈용 로거. 최초 호출 시 자동 설정."""
    setup_logging()
    return logging.getLogger(name)
