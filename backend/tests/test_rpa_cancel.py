"""RPA 취소 인프라 회귀 — 데스크탑앱 '멈춤' 근본 해소(감사)의 계약 고정.

실제 브라우저 없이 가짜 run_coro/러너로 취소·타임아웃·여정 종결만 검증한다.
1) 협조적 취소(check_cancel) → cancelled + 슬롯 반납
2) 큐 대기 중 취소 → 실행 전 즉시 cancelled(브라우저 안 뜸)
3) 취소가 대기건에 슬롯을 넘김
4) 종결/미존재 태스크 취소는 False
5) 타임아웃이 이미 done 인 태스크를 error 로 덮지 않음
6) _live_tasks 레지스트리 누수 없음
7) 여정: 종결상태 보장·중단·퇴거·중복시작 인지
8) base 헬퍼: check_cancel/cancellable_sleep/context_alive
"""
import asyncio
import pytest

from rpa import manager, orchestrator
from rpa.base import check_cancel, cancellable_sleep, context_alive, CancelledByUser


@pytest.fixture(autouse=True)
def reset_state(monkeypatch):
    monkeypatch.setattr(manager, "_MAX_CONCURRENT", 2)
    monkeypatch.setattr(manager, "_MAX_QUEUE", 8)
    monkeypatch.setattr(manager, "_TASK_TIMEOUT", 30)
    monkeypatch.setattr(manager, "_MAX_TASKS", 200)
    manager._sem = None
    manager._active = 0
    manager._waiting = 0
    manager._rpa_tasks.clear()
    manager._live_tasks.clear()
    orchestrator._journeys.clear()
    yield
    manager._sem = None
    manager._active = 0
    manager._waiting = 0
    manager._rpa_tasks.clear()
    manager._live_tasks.clear()
    orchestrator._journeys.clear()


async def _coop_runner(task, started: asyncio.Event = None):
    """협조적 취소를 확인하는 러너 — 실제 RPA 대기루프 모사(check_cancel 로 CancelledByUser)."""
    task.update("running", "진행 중")
    if started:
        started.set()
    for _ in range(2000):
        check_cancel(task, None)
        await asyncio.sleep(0.01)


# ── 1) 협조적 취소 ───────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_cooperative_cancel_stops_and_frees_slot():
    t = manager.RPATask("coop", "주민등록등본", "홍길동")
    manager._rpa_tasks[t.task_id] = t
    started = asyncio.Event()
    run = asyncio.create_task(manager._guarded_run(t, lambda: _coop_runner(t, started)))
    await asyncio.wait_for(started.wait(), timeout=2)
    assert manager.request_cancel("coop") is True
    await asyncio.wait_for(run, timeout=5)
    assert manager._rpa_tasks["coop"]["status"] == "cancelled"
    assert manager._active == 0
    assert "coop" not in manager._live_tasks  # 레지스트리 누수 없음


# ── 2) 큐 대기 중 취소 → 실행 전 즉시 종료(post-slot 게이트) ─────────────────
@pytest.mark.asyncio
async def test_queued_cancel_bails_before_running():
    monkeypatch_max = 1
    manager._MAX_CONCURRENT = monkeypatch_max
    manager._sem = None
    release = asyncio.Event()
    ran = {"third": False}

    async def holder(task):
        task.update("running", "점유")
        await release.wait()

    async def third_runner(task):
        ran["third"] = True  # 취소됐으면 여기 도달하면 안 됨
        task.update("running", "시작하면 안 됨")
        await asyncio.sleep(1)

    h = manager.RPATask("hold", "등본", "홍")
    manager._rpa_tasks[h.task_id] = h
    run_h = asyncio.create_task(manager._guarded_run(h, lambda: holder(h)))
    await asyncio.sleep(0.1)  # holder 가 슬롯 점유

    q = manager.RPATask("queued", "등본", "홍")
    manager._rpa_tasks[q.task_id] = q
    run_q = asyncio.create_task(manager._guarded_run(q, lambda: third_runner(q)))
    await asyncio.sleep(0.1)  # queued 가 대기열에 들어감
    assert manager._rpa_tasks["queued"]["status"] == "queued"

    assert manager.request_cancel("queued") is True  # 대기 중 취소
    release.set()  # holder 종료 → queued 가 슬롯 획득
    await asyncio.wait_for(asyncio.gather(run_h, run_q), timeout=5)
    assert ran["third"] is False, "취소된 큐 태스크가 실행됐다(브라우저를 띄웠을 것)"
    assert manager._rpa_tasks["queued"]["status"] == "cancelled"
    assert manager._active == 0


# ── 3) 취소가 대기건에 슬롯을 넘김 ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_cancel_promotes_waiting_task():
    manager._MAX_CONCURRENT = 2
    manager._sem = None
    started = {}
    events = {}

    def mk(name):
        ev = asyncio.Event()
        events[name] = ev
        async def r(task):
            task.update("running", "점유")
            started[name] = True
            for _ in range(2000):
                check_cancel(task, None)
                await asyncio.sleep(0.01)
        t = manager.RPATask(name, "등본", "홍")
        manager._rpa_tasks[name] = t
        return asyncio.create_task(manager._guarded_run(t, lambda t=t: r(t)))

    a, b, c = mk("A"), mk("B"), mk("C")
    await asyncio.sleep(0.15)
    assert manager._rpa_tasks["C"]["status"] == "queued"  # 3번째는 대기
    manager.request_cancel("A")  # A 취소 → C 승격
    await asyncio.sleep(0.2)
    assert manager._rpa_tasks["A"]["status"] == "cancelled"
    assert started.get("C") is True, "대기하던 C가 승격되지 않음"
    # 정리
    for n in ("B", "C"):
        manager.request_cancel(n)
    await asyncio.wait_for(asyncio.gather(a, b, c), timeout=5)
    assert manager._active == 0


# ── 4) 종결/미존재 취소는 False ──────────────────────────────────────────────
def test_request_cancel_false_for_missing():
    assert manager.request_cancel("does-not-exist") is False


@pytest.mark.asyncio
async def test_request_cancel_false_after_done():
    t = manager.RPATask("d", "등본", "홍")
    manager._rpa_tasks[t.task_id] = t
    async def quick(task):
        task.update("done", "완료")
    await manager._guarded_run(t, lambda: quick(t))
    assert manager._rpa_tasks["d"]["status"] == "done"
    assert manager.request_cancel("d") is False  # 이미 종결


# ── 5) 타임아웃이 done 을 덮지 않음 ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_timeout_does_not_overwrite_done(monkeypatch):
    monkeypatch.setattr(manager, "_TASK_TIMEOUT", 1)
    async def done_then_hang(task):
        task.update("done", "발급 완료")
        task.result = {"success": True, "saved_path": "/x.pdf"}
        await asyncio.sleep(30)  # done 후에도 유예로 살아있는 상황
    t = manager.RPATask("dh", "등본", "홍")
    manager._rpa_tasks[t.task_id] = t
    await manager._guarded_run(t, lambda: done_then_hang(t))
    assert manager._rpa_tasks["dh"]["status"] == "done"  # error 로 안 덮임
    assert manager._active == 0


# ── 7) 여정 종결/중단/퇴거/중복인지 ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_journey_reaches_terminal_and_collects_saved(monkeypatch):
    async def fake_doc(task, name, info):
        task.update("done", "발급 완료")
        task.result = {"success": True, "saved_path": f"/docs/{name}.pdf"}
    monkeypatch.setattr(orchestrator, "_run_step_doc", fake_doc)
    jid, docs, svcs = orchestrator.start_journey(["주민등록등본"], [], "홍길동", {}, {})
    j = None
    for _ in range(200):
        await asyncio.sleep(0.02)
        j = orchestrator._journeys[jid]
        if j["status"] in orchestrator._JOURNEY_TERMINAL:
            break
    assert j["status"] == "completed"
    assert j["steps"][0]["status"] == "done"
    assert j["saved_docs"] == ["/docs/주민등록등본.pdf"]


@pytest.mark.asyncio
async def test_journey_cancel_stops_remaining_steps(monkeypatch):
    async def slow_doc(task, name, info):
        task.update("running", "진행 중")
        for _ in range(2000):
            check_cancel(task, None)
            await asyncio.sleep(0.01)
    monkeypatch.setattr(orchestrator, "_run_step_doc", slow_doc)
    jid, _, _ = orchestrator.start_journey(["주민등록등본", "가족관계증명서"], [], "홍", {}, {})
    # 첫 단계가 running 될 때까지
    for _ in range(200):
        await asyncio.sleep(0.02)
        if orchestrator._journeys[jid].get("current"):
            break
    assert orchestrator.request_journey_cancel(jid) is True
    for _ in range(200):
        await asyncio.sleep(0.02)
        if orchestrator._journeys[jid]["status"] in orchestrator._JOURNEY_TERMINAL:
            break
    j = orchestrator._journeys[jid]
    assert j["status"] == "cancelled"
    # 두 번째 단계는 시작조차 안 됨(cancelled 또는 pending 로 남되 running/ done 아님)
    assert j["steps"][1]["status"] in ("cancelled", "pending")


def test_active_journey_id_and_eviction(monkeypatch):
    monkeypatch.setattr(orchestrator, "_MAX_JOURNEYS", 3)
    # 진행 중 여정 인지
    orchestrator._journeys["run1"] = {"status": "running", "created_at": "2026-07-15T00:00:01", "steps": []}
    assert orchestrator.active_journey_id() == "run1"
    # 종결 여정만 퇴거, 진행 중은 생존
    for i in range(5):
        orchestrator._journeys[f"done{i}"] = {"status": "completed", "created_at": f"2026-07-15T00:00:{i:02d}", "steps": []}
    orchestrator._evict_journeys()
    assert "run1" in orchestrator._journeys  # 진행 중 생존
    assert len(orchestrator._journeys) <= 3


def test_request_journey_cancel_false_for_terminal():
    orchestrator._journeys["j"] = {"status": "completed", "steps": [], "current": None}
    assert orchestrator.request_journey_cancel("j") is False
    assert orchestrator.request_journey_cancel("missing") is False


# ── 8) base 헬퍼 ─────────────────────────────────────────────────────────────
def test_check_cancel_raises_on_flag():
    class T:
        cancel_requested = True
    with pytest.raises(CancelledByUser):
        check_cancel(T(), None)


def test_check_cancel_noop_when_not_requested():
    class T:
        cancel_requested = False
    check_cancel(T(), None)  # 예외 없어야 함


@pytest.mark.asyncio
async def test_cancellable_sleep_returns_quickly_on_cancel():
    class T:
        cancel_requested = False
    t = T()
    async def cancel_soon():
        await asyncio.sleep(0.05)
        t.cancel_requested = True
    asyncio.create_task(cancel_soon())
    with pytest.raises(CancelledByUser):
        await cancellable_sleep(10, t, None)  # 10초여도 취소되면 즉시 탈출


@pytest.mark.asyncio
async def test_context_alive_detects_all_closed():
    class Page:
        def __init__(self, closed): self._c = closed
        def is_closed(self): return self._c
    class Ctx:
        def __init__(self, pages): self.pages = pages
    assert await context_alive(Ctx([Page(False), Page(True)])) is True   # 하나라도 살아있음
    assert await context_alive(Ctx([Page(True), Page(True)])) is False   # 전부 닫힘


# ── 9) 여정 개별 단계 건너뛰기(skip) — 전체 중단과 구분 ─────────────────────────
@pytest.mark.asyncio
async def test_journey_skip_current_step_continues_next(monkeypatch):
    """현재 단계만 cancelled 로 접고 여정은 다음 단계로 계속 — 스킵 후 다음 단계가 실제로 돌아
    성공하면 여정 최종 상태는 completed(중단 아님)여야 한다. 스킵 플래그는 소모된다."""
    ran = []

    async def doc_runner(task, name, info):
        task.update("running", "진행 중")
        ran.append(name)
        if name == "주민등록등본":
            for _ in range(2000):  # 스킵 요청이 올 때까지 진행 흉내(협조적 취소 루프)
                check_cancel(task, None)
                await asyncio.sleep(0.01)
        else:  # 다음 단계는 즉시 성공
            task.update("done", "발급 완료")
            task.result = {"success": True, "saved_path": f"/docs/{name}.pdf"}

    monkeypatch.setattr(orchestrator, "_run_step_doc", doc_runner)
    jid, _, _ = orchestrator.start_journey(["주민등록등본", "가족관계증명서"], [], "홍", {}, {})
    for _ in range(200):
        await asyncio.sleep(0.02)
        if orchestrator._journeys[jid].get("current") == "주민등록등본" and ran:
            break
    assert orchestrator.request_journey_skip(jid) is True
    j = orchestrator._journeys[jid]
    for _ in range(400):
        await asyncio.sleep(0.02)
        if j["status"] in orchestrator._JOURNEY_TERMINAL:
            break
    assert j["steps"][0]["status"] == "cancelled"   # 스킵된 단계
    assert "가족관계증명서" in ran                    # 다음 단계가 '실제로' 실행됨
    assert j["steps"][1]["status"] == "done"
    assert j["status"] == "completed"               # 여정은 중단이 아니라 완료
    assert not j.get("skip_step_task_id")           # 플래그 소모(다음 단계 오염 없음)
    assert j["saved_docs"] == ["/docs/가족관계증명서.pdf"]


def test_journey_skip_rejects_when_no_current_or_terminal():
    """건너뛸 '현재 단계'가 없거나(시작 전) 여정이 끝났으면 skip 은 False — 오동작 금지."""
    orchestrator._journeys["sk1"] = {"status": "running", "current_task_id": None, "steps": []}
    assert orchestrator.request_journey_skip("sk1") is False
    orchestrator._journeys["sk2"] = {"status": "completed", "current_task_id": "t1", "steps": []}
    assert orchestrator.request_journey_skip("sk2") is False
    assert orchestrator.request_journey_skip("없는여정") is False
