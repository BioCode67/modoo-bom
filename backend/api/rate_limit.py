"""가벼운 인메모리 레이트 리미터 — 공개 배포 시 남용·비용 폭주 방지(감사 반영).

외부 의존성 없이 IP별 고정 윈도우 카운터로 제한한다. 무료 티어 단일 인스턴스 전제
(다중 워커·수평 확장 시에는 Redis 기반으로 교체 권장). 로컬 개발/테스트에선 관대하게 동작.
"""
import os
import time
from collections import defaultdict
from fastapi import Request
from fastapi.responses import JSONResponse

# 경로 접두사별 분당 허용 횟수(기본값). RATE_LIMIT_PER_MIN 로 전역 배수 조정 가능.
_LIMITS = {
    "/api/search": 40,
    "/api/estimate": 40,
    "/api/journey": 20,
    "/api/documents/issue": 20,
    "/api/documents/rpa-issue": 10,
    "/api/apply": 10,
    "/api/admin": 30,
}
_WINDOW = 60.0  # 초
_buckets: dict[str, list] = defaultdict(lambda: [0, 0.0])  # key -> [count, window_start]


def _limit_for(path: str) -> int | None:
    for prefix, n in _LIMITS.items():
        if path.startswith(prefix):
            scale = float(os.getenv("RATE_LIMIT_PER_MIN_SCALE", "1") or "1")
            return max(1, int(n * scale))
    return None


def _client_ip(request: Request) -> str:
    # 프록시(Render 등) 뒤에서는 X-Forwarded-For 첫 IP 사용.
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def rate_limit_middleware(request: Request, call_next):
    path = request.url.path
    limit = _limit_for(path)
    if limit is None:
        return await call_next(request)
    key = f"{_client_ip(request)}:{path.split('/')[2] if path.count('/') >= 2 else path}"
    count, start = _buckets[key]
    now = time.time()
    if now - start >= _WINDOW:
        _buckets[key] = [1, now]
    elif count >= limit:
        retry = int(_WINDOW - (now - start)) + 1
        return JSONResponse(
            status_code=429,
            content={"detail": "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."},
            headers={"Retry-After": str(retry)},
        )
    else:
        _buckets[key][0] = count + 1
    return await call_next(request)
