"""🧠 route_cache(경로 기억) 계약 + ai_pick_action 통합 — Skyvern route memorization의 우리판.
프라이버시(라벨만 저장)·밸브·무효화·통합(캐시 라벨 우선/성공 기억/미스 무효화)을 잠근다."""
import asyncio
import json


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _tmp_cache(monkeypatch, tmp_path):
    """실 파일 대신 격리된 tmp 캐시 경로 + 밸브 ON."""
    p = tmp_path / "route_cache.json"
    monkeypatch.setenv("MODOOBOM_ROUTE_CACHE", str(p))
    monkeypatch.delenv("RPA_ROUTE_CACHE", raising=False)
    return p


def test_route_cache_remember_get_forget(monkeypatch, tmp_path):
    p = _tmp_cache(monkeypatch, tmp_path)
    from rpa import route_cache as rc
    assert rc.get_label("gov24", "문서출력") == ""      # 초기엔 없음
    rc.remember("gov24", "문서출력", "출력하기")
    assert rc.get_label("gov24", "문서출력") == "출력하기"
    # 파일엔 '라벨'만 저장(개인정보·값 없음)
    saved = json.loads(p.read_text(encoding="utf-8"))
    assert list(saved.values())[0] == {"label": "출력하기"}
    rc.forget("gov24", "문서출력")
    assert rc.get_label("gov24", "문서출력") == ""       # 무효화됨


def test_route_cache_valve_off(monkeypatch, tmp_path):
    _tmp_cache(monkeypatch, tmp_path)
    monkeypatch.setenv("RPA_ROUTE_CACHE", "0")           # 밸브 OFF → 전체 무동작
    from rpa import route_cache as rc
    rc.remember("gov24", "g", "x")
    assert rc.get_label("gov24", "g") == ""


def test_route_cache_missing_args_noop(monkeypatch, tmp_path):
    _tmp_cache(monkeypatch, tmp_path)
    from rpa import route_cache as rc
    rc.remember("", "g", "x")           # site 없음
    rc.remember("s", "g", "")           # 라벨 없음
    assert rc.get_label("s", "g") == ""


# ── ai_pick_action 통합 ─────────────────────────────────────────────────────
def _nav_ctx(fields, clicked):
    import re as _re

    class _Loc:
        def __init__(self, sel):
            self.sel = sel
        async def click(self, timeout=None):
            m = _re.search(r"data-modoobom-ai='(\d+)'", self.sel)
            clicked.append(int(m.group(1)) if m else -1)

    class _Ctx:
        async def evaluate(self, js, *a):
            return fields
        def locator(self, sel):
            return _Loc(sel)

    return _Ctx()


def test_ai_pick_action_prefers_cached_label(monkeypatch, tmp_path):
    """경로 기억 — 지난 성공 라벨을 want_texts 보다 '먼저' 시도한다(빠른 결정론 경로)."""
    _tmp_cache(monkeypatch, tmp_path)
    from rpa import route_cache as rc
    from rpa import ai_fill as af
    rc.remember("gov24", "문서 출력", "특별출력")       # 지난번 이 라벨로 성공했다고 기억
    clicked = []
    fields = [
        {"idx": 0, "role": "button", "text": "출력하기", "type": "button"},  # want_texts 매치
        {"idx": 1, "role": "button", "text": "특별출력", "type": "button"},  # 캐시 라벨 매치
    ]
    ok = _run(af.ai_pick_action(_nav_ctx(fields, clicked), "문서 출력",
                                ["출력하기"], site="gov24"))
    assert ok is True
    assert clicked == [1]        # 캐시('특별출력')가 want('출력하기')보다 먼저 → idx1 클릭


def test_ai_pick_action_remembers_on_success(monkeypatch, tmp_path):
    """성공한 클릭 라벨을 기억한다 — 다음 실행 가속(route memorization)."""
    _tmp_cache(monkeypatch, tmp_path)
    from rpa import route_cache as rc
    from rpa import ai_fill as af
    clicked = []
    fields = [{"idx": 0, "role": "button", "text": "문서 출력", "type": "button"}]
    ok = _run(af.ai_pick_action(_nav_ctx(fields, clicked), "문서 출력",
                                ["문서출력"], site="gov24"))
    assert ok is True
    assert rc.get_label("gov24", "문서 출력") == "문서 출력"  # 성공 라벨 기억됨


def test_ai_pick_action_forgets_stale_cache(monkeypatch, tmp_path):
    """캐시 라벨이 현재 화면 후보에 없으면(사이트 문구 변경) 무효화하고 다음엔 다시 학습."""
    _tmp_cache(monkeypatch, tmp_path)
    from rpa import route_cache as rc
    from rpa import ai_fill as af
    rc.remember("gov24", "g", "옛날버튼")               # 더는 존재하지 않는 라벨
    clicked = []
    fields = [{"idx": 0, "role": "button", "text": "닫기", "type": "button"}]
    ok = _run(af.ai_pick_action(_nav_ctx(fields, clicked), "g", ["없는버튼"], site="gov24"))
    assert ok is False
    assert clicked == []
    assert rc.get_label("gov24", "g") == ""             # 스테일 캐시 무효화됨


def test_ai_pick_action_scored_grounding_prefers_exact(monkeypatch, tmp_path):
    """의미 접지 점수화 — 부분일치보다 '정확일치' 버튼을 우선 지목(오클릭 감소)."""
    _tmp_cache(monkeypatch, tmp_path)
    from rpa import ai_fill as af
    clicked = []
    fields = [
        {"idx": 0, "role": "button", "text": "문서출력 도움말", "type": "button"},  # 부분일치(45)
        {"idx": 1, "role": "button", "text": "문서출력", "type": "button"},          # 정확일치(100)
    ]
    ok = _run(af.ai_pick_action(_nav_ctx(fields, clicked), "문서출력", ["문서출력"]))
    assert ok is True
    assert clicked == [1]        # 정확일치(idx1)를 문서순 첫 부분일치(idx0)보다 우선
