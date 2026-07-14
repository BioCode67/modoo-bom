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


def test_client_ip_uses_rightmost_xff_not_spoofable_leftmost():
    """19차 감사: 최좌측 XFF는 클라 위조 가능 → 신뢰 프록시가 append한 최우측 홉을 사용해야
    XFF 회전으로 IP별 레이트리밋을 우회할 수 없다."""
    from api.rate_limit import _client_ip

    class _Req:
        def __init__(self, xff):
            self.headers = {"x-forwarded-for": xff} if xff else {}
            self.client = type("C", (), {"host": "5.5.5.5"})()

    # 봇이 위조한 첫 토큰(1.1.1.1) 무시, Render가 붙인 실제 IP(9.9.9.9) 채택
    assert _client_ip(_Req("1.1.1.1, 9.9.9.9")) == "9.9.9.9"
    # 회전시켜도 우측이 동일하면 같은 버킷(우회 불가)
    assert _client_ip(_Req("2.2.2.2, 9.9.9.9")) == "9.9.9.9"
    # XFF 없으면 소켓 IP 폴백
    assert _client_ip(_Req("")) == "5.5.5.5"


def test_ws_client_ip_uses_rightmost_xff():
    from api.ws_rate_limit import _client_ip as ws_ip

    class _WS:
        def __init__(self, xff):
            self.headers = {"x-forwarded-for": xff}
            self.client = type("C", (), {"host": "7.7.7.7"})()

    assert ws_ip(_WS("1.1.1.1, 8.8.8.8")) == "8.8.8.8"
    assert ws_ip(_WS("")) == "7.7.7.7"
