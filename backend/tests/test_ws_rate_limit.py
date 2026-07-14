# -*- coding: utf-8 -*-
"""WS 남용 방지 레이트리밋 회귀 — 무제한 LLM 호출 벡터 차단(2026-07 보안 감사)."""
import api.ws_rate_limit as wr


class _FakeWS:
    """WS 헤더/클라이언트를 흉내 — x-forwarded-for로 IP 지정."""
    def __init__(self, ip="1.2.3.4", via_xff=True):
        # 실제 클라이언트 IP는 신뢰 프록시(Render)가 붙이는 '최우측' — 최좌측은 클라 위조 가능(19차 감사).
        self.headers = {"x-forwarded-for": f"1.1.1.1, {ip}"} if via_xff else {}
        self._ip = ip

        class _C:
            host = ip
        self.client = _C()


def setup_function():
    wr._msg_buckets.clear()
    wr._conn_buckets.clear()


def test_client_ip_prefers_xff():
    assert wr._client_ip(_FakeWS("203.0.113.9")) == "203.0.113.9"
    ws = _FakeWS("9.9.9.9", via_xff=False)
    assert wr._client_ip(ws) == "9.9.9.9"  # xff 없으면 client.host


def test_allow_message_blocks_over_limit():
    ws = _FakeWS("5.5.5.5")
    now = 1000.0
    lim = wr._MSG_PER_MIN
    # 한도까지는 허용
    for _ in range(lim):
        assert wr.allow_message(ws, now=now) is True
    # 한도 초과 → 차단
    assert wr.allow_message(ws, now=now) is False


def test_window_resets_after_60s():
    ws = _FakeWS("6.6.6.6")
    lim = wr._MSG_PER_MIN
    for _ in range(lim):
        wr.allow_message(ws, now=2000.0)
    assert wr.allow_message(ws, now=2000.0) is False   # 같은 윈도우 → 차단
    assert wr.allow_message(ws, now=2061.0) is True     # 60초 경과 → 새 윈도우 허용


def test_per_ip_isolation():
    now = 3000.0
    a, b = _FakeWS("7.7.7.7"), _FakeWS("8.8.8.8")
    for _ in range(wr._MSG_PER_MIN):
        wr.allow_message(a, now=now)
    assert wr.allow_message(a, now=now) is False  # A는 소진
    assert wr.allow_message(b, now=now) is True   # B는 독립


def test_connection_limit_independent_of_message():
    ws = _FakeWS("4.4.4.4")
    now = 4000.0
    for _ in range(wr._CONN_PER_MIN):
        assert wr.allow_connection(ws, now=now) is True
    assert wr.allow_connection(ws, now=now) is False
    # 메시지 버킷은 연결과 분리 → 여전히 허용
    assert wr.allow_message(ws, now=now) is True


def test_bucket_eviction_bounds_growth():
    saved = wr._MAX_KEYS
    try:
        wr._MAX_KEYS = 10
        now = 5000.0
        for i in range(12):
            wr._msg_buckets[f"ip{i}"] = [1, now - 200]  # 모두 만료
        wr._evict(wr._msg_buckets, now)
        assert len(wr._msg_buckets) == 0
    finally:
        wr._MAX_KEYS = saved
        wr._msg_buckets.clear()


def test_default_limits_are_generous_for_demo():
    # 사람은 절대 못 넘는 넉넉한 기본값(경진대회 데모 안 깨짐) — 최소 하한 보장.
    lim = wr.limits()
    assert lim["msg_per_min"] >= 30
    assert lim["conn_per_min"] >= 20
