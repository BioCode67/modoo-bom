"""레이트리밋 — CORS/PNA 프리플라이트(OPTIONS) 제외 검증(감사 반영)."""
import pytest

from api import rate_limit


class _URL:
    def __init__(self, path):
        self.path = path


class _Client:
    host = "9.9.9.9"


class _Req:
    def __init__(self, method, path):
        self.method = method
        self.url = _URL(path)
        self.headers = {}
        self.client = _Client()


@pytest.mark.asyncio
async def test_options_preflight_exempt_from_ratelimit():
    """OPTIONS 프리플라이트는 한도를 훌쩍 넘겨도 항상 통과(카운트 안 됨)."""
    async def call_next(_req):
        return "passed"

    for _ in range(100):  # /api/search 한도(40)의 2배 이상 — OPTIONS라 무제한 통과
        r = await rate_limit.rate_limit_middleware(_Req("OPTIONS", "/api/search"), call_next)
        assert r == "passed"


@pytest.mark.asyncio
async def test_non_ratelimited_path_passes():
    async def call_next(_req):
        return "passed"
    # 한도 목록에 없는 경로는 그대로 통과
    r = await rate_limit.rate_limit_middleware(_Req("GET", "/api/health"), call_next)
    assert r == "passed"
