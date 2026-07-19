"""local_server(설치본) 와 main/api.routes(클라우드)의 RPA 엔드포인트 '행동 파리티' 고정.

두 앱은 RPA 엔드포인트를 **의도적으로 복제**한다(local_server 는 chromadb 비의존 경량성 때문).
한쪽만 보안 로직을 고치면 설치본이 취약해지므로, 핵심 인가·게이팅이 양쪽에서 동일한지 테스트로 못박는다.
(TestClient 를 컨텍스트매니저 없이 써 lifespan/ChromaDB 시딩은 건드리지 않는다.)
"""
import pytest
from fastapi.testclient import TestClient

import local_server
import main  # 클라우드 풀스택 앱(라우트만 사용, 시딩은 lifespan이라 미실행)

_lc = TestClient(local_server.app)
_mc = TestClient(main.app)
_CLIENTS = (("local_server", _lc), ("routes", _mc))


def test_rpa_file_token_parity():
    """두 앱 모두 잘못된/누락 토큰이면 403(다운로드 인가 동일)."""
    from rpa import manager
    manager._rpa_tasks["par1"] = {"status": "done", "download_token": "realtok",
                                  "result": {"saved_path": __file__}}
    try:
        for name, c in _CLIENTS:
            assert c.get("/api/documents/rpa-file/par1?t=WRONG").status_code == 403, name
            assert c.get("/api/documents/rpa-file/par1").status_code == 403, name
    finally:
        manager._rpa_tasks.pop("par1", None)


def test_rpa_status_token_strip_parity():
    """두 앱 모두 rpa-status 응답에서 download_token 을 제거."""
    from rpa import manager
    manager._rpa_tasks["par2"] = {"status": "running", "download_token": "s", "current_step": "x"}
    try:
        for name, c in _CLIENTS:
            assert "download_token" not in c.get("/api/documents/rpa-status/par2").json(), name
    finally:
        manager._rpa_tasks.pop("par2", None)


def test_apply_start_gating_parity(monkeypatch):
    """두 앱 모두 지원목록 밖 + 딥링크 없음이면 400(게이팅 동일)."""
    monkeypatch.setenv("RPA_ENABLED", "1")
    for name, c in _CLIENTS:
        r = c.post("/api/apply/start", json={"service_name": "존재하지않는서비스"})
        assert r.status_code == 400, f"{name}: {r.status_code}"


def test_rpa_supported_parity():
    """지원 서류 목록이 양쪽 동일(능력 확장 시 한쪽만 늘어나 드리프트하는 것 방지)."""
    a = _lc.get("/api/documents/rpa-supported").json()["supported"]
    b = _mc.get("/api/documents/rpa-supported").json()["supported"]
    assert a == b


def test_status_screenshot_gate_parity():
    """스크린샷(PII 가능)이 두 앱 모두 '시작자 토큰(?t=) 일치 시에만' 포함되는지 — 게이트 패리티."""
    from rpa import manager
    for tid, path in (("scp1", "/api/documents/rpa-status/scp1"), ("scp2", "/api/apply/status/scp2")):
        manager._rpa_tasks[tid] = {"status": "running", "download_token": "tokP",
                                   "screenshot_b64": "IMG", "current_step": "x"}
        try:
            for name, c in _CLIENTS:
                assert "screenshot_b64" not in c.get(path).json(), name
                assert "screenshot_b64" not in c.get(path + "?t=WRONG").json(), name
                assert c.get(path + "?t=tokP").json().get("screenshot_b64") == "IMG", name
        finally:
            manager._rpa_tasks.pop(tid, None)


def test_journey_skip_parity():
    """두 앱 모두 /journey/skip 노출 + 미지 여정엔 200 {'skipped': False} — 개별 스킵 게이팅 동일."""
    for name, c in _CLIENTS:
        r = c.post("/api/journey/skip/none-such")
        assert r.status_code == 200 and r.json() == {"skipped": False}, name


def test_session_reset_shared_guard_parity(monkeypatch):
    """🔒 RPA_SHARED=1 이면 두 앱 모두 /api/session/reset 을 403 으로 차단.

    회귀 고정 사유: routes.py 쪽에만 _shared_mode_guard() 가 빠져 있어, 공유(터널) 배포에서
    무인증 POST 한 번으로 다른 이용자가 방금 발급한 서류가 전부 지워질 수 있었다.
    docstring 은 '(local_server 패리티)'라고 주장했지만 실제로는 파리티가 아니었다."""
    monkeypatch.setenv("RPA_SHARED", "1")
    for name, c in _CLIENTS:
        assert c.post("/api/session/reset").status_code == 403, name


def test_destructive_endpoint_guard_coverage():
    """파괴적·PII 노출 엔드포인트는 두 앱 모두 공유모드 가드를 '갖고 있어야' 한다(구조 파리티).

    개별 동작 테스트는 위에서 하고, 여기선 '한쪽에만 새 파괴적 라우트가 생기는' 드리프트를 잡는다."""
    import inspect
    import api.routes as routes_mod

    for mod in (local_server, routes_mod):
        src = inspect.getsource(mod)
        assert "_shared_mode_guard" in src, f"{mod.__name__}: 공유모드 가드 자체가 없음"
        # session_reset 본문에 가드 호출이 실제로 들어있는지(정의만 해두고 안 부르는 것 방지)
        body = src.split("async def session_reset(")[1].split("\n@")[0]
        assert "_shared_mode_guard()" in body, f"{mod.__name__}: session_reset 이 가드를 호출하지 않음"
