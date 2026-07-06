"""WebSocket 보안 유틸 — WS는 CORS가 적용되지 않으므로 Origin을 직접 검증한다.
(임의 사이트가 /ws/chat·/ws/analyze를 열어 LLM 쿼터를 소모하는 것을 차단.)"""
import os
from fastapi import WebSocket


# main.py의 CORSMiddleware 기본값과 동일하게 유지(라이브 배포 도메인 포함) —
# CORS_ORIGINS 환경변수를 안 넣어도 배포 프론트(github.io)의 WS가 바로 붙게 한다.
_DEFAULT_ORIGINS = (
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,https://biocode67.github.io"
)


def _allowed_origins() -> set[str]:
    raw = os.getenv("CORS_ORIGINS", _DEFAULT_ORIGINS)
    return {o.strip().rstrip("/") for o in raw.split(",") if o.strip()}


async def reject_bad_origin(ws: WebSocket) -> bool:
    """허용 Origin이 아니면 연결을 거절(close)하고 True 반환. 허용이면 False.
    - Origin 헤더가 없으면(비브라우저 클라이언트) 로컬 개발 편의상 허용한다.
    - 배포에선 CORS_ORIGINS에 실제 프론트 도메인만 넣어 통제한다."""
    origin = (ws.headers.get("origin") or "").rstrip("/")
    if not origin:
        return False  # 브라우저 외 클라이언트(도구·테스트) — 허용
    if origin in _allowed_origins():
        return False
    await ws.close(code=1008)  # policy violation
    return True
