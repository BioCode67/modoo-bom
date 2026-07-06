"""WebSocket 남용 방지 — IP별 연결·메시지 레이트리밋.

WS는 HTTP 미들웨어(api/rate_limit.py)를 핸드셰이크 이후 우회하므로, /ws/chat·/ws/analyze의
LLM 호출이 무제한으로 남용될 수 있다(공개 배포 시 Gemini 비용 폭주 벡터). 여기서 IP별
고정 윈도우 카운터로 '연결 개설'과 '메시지 처리'를 각각 제한한다.

⚠️ 기본값은 데모/경진대회를 깨지 않게 넉넉하다(사람은 절대 못 넘고, 스크립트 남용만 차단).
   실제 공개 런칭 시 env로 조인다: WS_MAX_MSG_PER_MIN / WS_MAX_CONN_PER_MIN.
   (X-Forwarded-For는 위조 가능 → 버킷 폭주 방지 상한도 둔다.)

단일 인스턴스(무료 티어) 전제. 수평 확장 시 Redis 등 공유 저장소로 교체 권장.
"""
import os
import time
from collections import defaultdict

_WINDOW = 60.0  # 초

# 사람은 절대 못 넘는 넉넉한 기본값(스크립트 남용만 차단). env로 런칭 시 조임.
_MSG_PER_MIN = max(1, int(os.getenv("WS_MAX_MSG_PER_MIN", "90") or "90"))
_CONN_PER_MIN = max(1, int(os.getenv("WS_MAX_CONN_PER_MIN", "60") or "60"))
_MAX_KEYS = max(1000, int(os.getenv("WS_RL_MAX_KEYS", "20000") or "20000"))

_msg_buckets: dict[str, list] = defaultdict(lambda: [0, 0.0])   # ip -> [count, window_start]
_conn_buckets: dict[str, list] = defaultdict(lambda: [0, 0.0])


def _client_ip(ws) -> str:
    """프록시(Render 등) 뒤에서는 X-Forwarded-For 첫 IP. (위조 가능 → 버킷 상한으로 방어)"""
    xff = ws.headers.get("x-forwarded-for", "") if hasattr(ws, "headers") else ""
    if xff:
        return xff.split(",")[0].strip()
    client = getattr(ws, "client", None)
    return getattr(client, "host", None) or "unknown"


def _evict(buckets: dict, now: float) -> None:
    if len(buckets) < _MAX_KEYS:
        return
    for k in [k for k, (_c, start) in buckets.items() if now - start >= _WINDOW]:
        buckets.pop(k, None)
    if len(buckets) >= _MAX_KEYS:
        buckets.clear()


def _hit(buckets: dict, key: str, limit: int, now: float) -> bool:
    """고정 윈도우 카운터 1회 증가. 한도 초과면 True(차단), 아니면 False(허용)."""
    _evict(buckets, now)
    count, start = buckets[key]
    if now - start >= _WINDOW:
        buckets[key] = [1, now]
        return False
    if count >= limit:
        return True
    buckets[key][0] = count + 1
    return False


def allow_connection(ws, now: float | None = None) -> bool:
    """새 WS 연결 허용 여부. IP별 분당 연결 개설 수 제한. True=허용, False=거절."""
    now = time.time() if now is None else now
    return not _hit(_conn_buckets, _client_ip(ws), _CONN_PER_MIN, now)


def allow_message(ws, now: float | None = None) -> bool:
    """메시지(LLM 호출 유발) 처리 허용 여부. IP별 분당 메시지 수 제한. True=허용."""
    now = time.time() if now is None else now
    return not _hit(_msg_buckets, _client_ip(ws), _MSG_PER_MIN, now)


def limits() -> dict:
    """현재 적용 한도(진단·문서용)."""
    return {"msg_per_min": _MSG_PER_MIN, "conn_per_min": _CONN_PER_MIN}
