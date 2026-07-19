"""여정 공유 브라우저 세션(GovSession) — '진짜 한 번 인증' 연쇄발급의 수명·계약 검증.

실브라우저(컨테이너 chromium, 헤드리스)로 세션 수명을 실제로 돌려보고,
gov24/orchestrator 의 세션 계약(로그인 스킵·브라우저 미종료·finally 정리)은 소스로 고정한다.
"""
import asyncio


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


class _FakePage:
    def __init__(self):
        self._closed = False

    def is_closed(self):
        return self._closed

    async def close(self):
        self._closed = True


class _FakeContext:
    async def add_init_script(self, _):
        pass

    async def new_page(self):
        return _FakePage()


class _FakeBrowser:
    def __init__(self):
        self.closed = False

    async def new_context(self, **_):
        return _FakeContext()

    async def close(self):
        self.closed = True


class _FakePW:
    async def stop(self):
        pass


class _FakeAPW:
    async def start(self):
        return _FakePW()


def test_gov_session_lifecycle(monkeypatch):
    """ensure()=신규 생성(True)→재사용(False), 창이 죽으면 재생성+logged_in 리셋, close()는 최종적.
    ※ 이 컨테이너의 파이썬 플레이라이트 레지스트리엔 크로뮴이 없어 가짜 브라우저로 '수명 로직'만
    검증한다(실기동 확인은 앱의 [발급 전 점검]/사용자 PC 리허설 몫 — 없는 검증을 한 척하지 않는다)."""
    from rpa import session as sess_mod
    from rpa.session import GovSession, close_quietly

    async def _fake_launch(_pw, *a, **k):
        return _FakeBrowser()

    monkeypatch.setattr(sess_mod, "launch_browser", _fake_launch)
    monkeypatch.setattr("playwright.async_api.async_playwright", lambda: _FakeAPW())

    async def run():
        s = GovSession()
        assert await s.ensure() is True          # 신규 생성 → 로그인 필요 상태
        assert s.alive() and s.logged_in is False
        s.logged_in = True                        # (여정 첫 서류가 로그인 완료했다고 가정)
        assert await s.ensure() is False          # 살아있으면 재사용 — 로그인 상태 유지
        assert s.logged_in is True
        await s.page.close()                      # 사용자가 창을 닫은 상황
        assert await s.ensure() is True           # 재생성 — 로그인 상태는 정직하게 리셋
        assert s.logged_in is False
        await s.close()
        assert s.closed and not s.alive()
        await close_quietly(s)                    # 중복 정리도 안전(idempotent)
        try:
            await s.ensure()
            raise AssertionError("closed 세션의 ensure 는 예외여야 함")
        except RuntimeError:
            pass

    _run(run())


def test_gov24_shared_session_contract():
    """gov24 세션 모드 계약 — 로그인 1회(이후 폼 직행), 세션 브라우저는 여기서 닫지 않는다."""
    src = open("rpa/gov24_rpa.py", encoding="utf-8").read()
    assert "session.logged_in = True" in src            # 로그인 성공이 세션에 기록돼야 후속 서류가 직행
    assert "같은 로그인으로 이어서" in src               # 후속 서류의 직행 안내(사용자에게 보이는 계약)
    # 발급 후 60초 유예·브라우저 종료는 '단독 실행'에서만 — 세션 브라우저를 서류가 닫으면 연쇄가 끊긴다
    assert "if session is None:\n                await cancellable_sleep(60" in src


def test_journey_creates_and_cleans_shared_session():
    """orchestrator 계약 — 정부24 2종 이상이면 공유 세션 생성, 종결 경로 무관 finally 정리."""
    src = open("rpa/orchestrator.py", encoding="utf-8").read()
    assert "GovSession() if (_gov_doc_count >= 2 and _one_login_on) else None" in src
    assert 'RPA_ONE_LOGIN' in src  # 실사이트 안전밸브 — 문제 시 env 로 즉시 기존 방식 복귀
    assert "await close_quietly(gov_session)" in src
    # 단계 실행에 세션이 실제로 전달돼야 한다(만들고 안 쓰는 죽은 배선 방지)
    assert '_run_step_doc(task, step["name"], user_info, gov_session)' in src


def test_journey_retries_failed_doc_once(monkeypatch):
    """🔁 문서 단계 자동 재시도 — '오류 종결'된 문서는 같은 여정에서 1회 더 시도하고,
    두 번째도 실패하면 그대로 정직하게 오류로 남는다(무한 재시도 금지)."""
    from rpa import orchestrator

    async def run():
        calls = {"등본": 0, "가족": 0}

        async def flaky(task, name, info, gov_session=None):
            key = "등본" if "등본" in name else "가족"
            calls[key] += 1
            if key == "등본" and calls[key] == 1:
                task.update("error", "일시 오류(첫 시도)")
            elif key == "가족":
                task.update("error", f"계속 실패({calls[key]}차)")  # 재시도해도 실패 — 2회에서 멈춰야 함
            else:
                task.update("done", "발급 완료")
                task.result = {"success": True, "saved_path": f"/docs/{name}.pdf"}

        monkeypatch.setattr(orchestrator, "_run_step_doc", flaky)
        jid, _, _ = orchestrator.start_journey(["주민등록등본", "가족관계증명서"], [], "홍", {}, {})
        for _ in range(400):
            await asyncio.sleep(0.02)
            if orchestrator._journeys[jid]["status"] in ("completed", "error", "cancelled"):
                break
        j = orchestrator._journeys.pop(jid)
        assert calls["등본"] == 2, "오류 1회 후 재시도가 없었음"
        assert calls["가족"] == 2, "재시도는 1회까지만이어야 함"
        steps = {s["name"]: s for s in j["steps"]}
        assert steps["주민등록등본"]["success"] is True      # 재시도로 살아난 발급
        assert steps["가족관계증명서"]["status"] == "error"   # 2회 실패는 정직하게 오류
        assert j["status"] == "completed"                    # 성공 1건 이상 → 여정은 완료로 종결

    _run(run())


def test_auto_attach_alias_matching():
    """📎 자동첨부 별칭 매칭 — 폼 라벨이 발급명보다 짧거나('자격득실확인서') 동의어('소득 증빙')여도
    올바른 칸에 붙고, 무관한 칸(신분증)엔 붙지 않는다. 신청인 이름 접미 제거도 함께 검증."""
    from rpa.apply_rpa import _auto_attach

    class _Input:
        def __init__(self, ctx):
            self._ctx = ctx
            self.attached = None
        async def evaluate(self, _js):
            return self._ctx
        async def set_input_files(self, path):
            self.attached = path

    class _Inputs:
        def __init__(self, items):
            self._items = items
        async def count(self):
            return len(self._items)
        def nth(self, i):
            return self._items[i]
        @property
        def first(self):
            return self._items[0]

    class _Page:
        def __init__(self, items):
            self._inputs = _Inputs(items)
        def locator(self, _sel):
            return self._inputs

    slots = [_Input("소득 증빙 서류 첨부"), _Input("건강보험 자격득실확인서 제출"),
             _Input("자격득실확인서"), _Input("신분증 사본")]
    issued = [("소득금액증명_홍길동", "/d/소득.pdf"), ("건강보험 자격득실확인서_홍길동", "/d/득실.pdf")]

    attached = _run(_auto_attach(_Page(slots), issued, applicant_name="홍길동"))
    assert slots[0].attached == "/d/소득.pdf"          # 동의어 라벨('소득 증빙') ← 소득금액증명
    assert slots[1].attached == "/d/득실.pdf"          # 전체명 라벨 — 기존 경로 유지
    assert slots[2].attached is None                   # 같은 서류는 한 번만(중복 첨부 금지)
    assert slots[3].attached is None                   # 무관한 칸(신분증)엔 안 붙는다
    assert len(attached) == 2
