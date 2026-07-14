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
# X-Forwarded-For는 클라이언트가 위조 가능 → 회전시키면 버킷이 무한 증가(리미터 자체가 메모리 고갈 벡터).
# 상한 초과 시 만료 버킷을 청소하고, 그래도 넘치면(공격 정황) 전체 초기화로 메모리 폭주를 차단.
_MAX_BUCKETS = max(1000, int(os.getenv("RATE_LIMIT_MAX_BUCKETS", "20000") or "20000"))


def _maybe_evict(now: float) -> None:
    if len(_buckets) < _MAX_BUCKETS:
        return
    for k in [k for k, (_c, start) in _buckets.items() if now - start >= _WINDOW]:
        _buckets.pop(k, None)
    if len(_buckets) >= _MAX_BUCKETS:
        _buckets.clear()  # 정상 사용자는 다음 윈도우에 재생성됨(제한이 잠깐 느슨해질 뿐)


def _limit_for(path: str) -> int | None:
    for prefix, n in _LIMITS.items():
        if path.startswith(prefix):
            scale = float(os.getenv("RATE_LIMIT_PER_MIN_SCALE", "1") or "1")
            return max(1, int(n * scale))
    return None


_TRUSTED_HOPS = max(1, int(os.getenv("TRUSTED_PROXY_HOPS", "1") or "1"))


def _client_ip(request: Request) -> str:
    # ⚠️ X-Forwarded-For의 '최좌측'은 클라이언트가 위조할 수 있다(Render 등 신뢰 프록시가 실제 IP를
    #   '오른쪽에 append'). 최좌측을 신뢰하면 봇이 XFF 첫 토큰을 회전시켜 IP별 레이트리밋을 완전 우회해
    #   LLM 쿼터를 소진할 수 있다(19차 감사). → 신뢰 프록시가 붙인 '오른쪽에서 N번째' 홉을 사용.
    xff = request.headers.get("x-forwarded-for", "")
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    if parts:
        idx = len(parts) - _TRUSTED_HOPS
        return parts[idx] if 0 <= idx < len(parts) else parts[-1]
    return request.client.host if request.client else "unknown"


async def rate_limit_middleware(request: Request, call_next):
    # CORS/PNA 프리플라이트(OPTIONS)는 카운트에서 제외 — 실요청과 쌍으로 와 유효 쿼터가 절반이 되고,
    # 429가 프리플라이트에 반환되면 CORS 헤더가 없어 브라우저엔 '레이트리밋'이 아니라 일반 CORS 오류로 보인다.
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    limit = _limit_for(path)
    if limit is None:
        return await call_next(request)
    now = time.time()
    _maybe_evict(now)  # 버킷 폭주 방지(위조 X-Forwarded-For 회전 대비)
    key = f"{_client_ip(request)}:{path.split('/')[2] if path.count('/') >= 2 else path}"
    count, start = _buckets[key]
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
