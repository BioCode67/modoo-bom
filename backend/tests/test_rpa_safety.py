"""다중 사용자 RPA 안전 계층 테스트 — 동시성 상한·큐·타임아웃·저장소 상한.

실제 브라우저 없이 가짜 run_coro로 안전장치만 검증한다(원격 다중접속에서 '안 터짐' 보장).
"""
import asyncio
import pytest

from rpa import manager


@pytest.fixture(autouse=True)
def small_limits(monkeypatch):
    # 테스트용 작은 상한 + 전역 상태 초기화
    monkeypatch.setattr(manager, "_MAX_CONCURRENT", 2)
    monkeypatch.setattr(manager, "_MAX_QUEUE", 3)
    monkeypatch.setattr(manager, "_TASK_TIMEOUT", 1)
    monkeypatch.setattr(manager, "_MAX_TASKS", 5)
    manager._sem = None
    manager._active = 0
    manager._waiting = 0
    manager._rpa_tasks.clear()
    yield
    manager._sem = None
    manager._active = 0
    manager._waiting = 0
    manager._rpa_tasks.clear()


def test_capacity_snapshot():
    cap = manager.capacity()
    assert cap["max_concurrent"] == 2
    assert cap["queue_limit"] == 3
    assert cap["accepting"] is True


def test_can_accept_gates_on_queue():
    assert manager.can_accept() is True
    manager._waiting = 3  # 큐가 가득 참
    assert manager.can_accept() is False


@pytest.mark.asyncio
async def test_concurrency_never_exceeds_cap():
    peak = {"v": 0}

    async def work():
        peak["v"] = max(peak["v"], manager._active)
        await asyncio.sleep(0.15)

    tasks = []
    for i in range(6):  # 상한(2)의 3배를 한꺼번에
        t = manager.RPATask(f"t{i}", "주민등록등본", "사용자")
        manager._rpa_tasks[t.task_id] = t
        tasks.append(asyncio.create_task(manager._guarded_run(t, work)))
    await asyncio.gather(*tasks)

    assert peak["v"] <= 2, f"동시 실행이 상한을 넘음: {peak['v']}"
    assert manager._active == 0
    assert manager._waiting == 0  # 슬롯·큐 카운트가 정확히 반납됨


@pytest.mark.asyncio
async def test_timeout_marks_error_and_frees_slot():
    async def hang():
        await asyncio.sleep(30)  # _TASK_TIMEOUT=1 을 초과

    t = manager.RPATask("hang", "주민등록등본", "사용자")
    manager._rpa_tasks[t.task_id] = t
    await manager._guarded_run(t, hang)

    assert manager._rpa_tasks["hang"]["status"] == "error"
    assert manager._active == 0  # 멈춘 세션이 슬롯을 영구 점유하지 않음


@pytest.mark.asyncio
async def test_exception_frees_slot():
    async def boom():
        raise RuntimeError("boom")

    t = manager.RPATask("boom", "주민등록등본", "사용자")
    manager._rpa_tasks[t.task_id] = t
    await manager._guarded_run(t, boom)

    assert manager._rpa_tasks["boom"]["status"] == "error"
    assert manager._active == 0
    assert manager._waiting == 0


@pytest.mark.asyncio
async def test_store_eviction_caps_memory():
    async def noop():
        return

    for i in range(9):  # _MAX_TASKS=5 초과
        t = manager.RPATask(f"e{i}", "주민등록등본", "사용자")
        manager._rpa_tasks[t.task_id] = t
        await manager._guarded_run(t, noop)

    assert len(manager._rpa_tasks) <= 5, "저장소가 상한을 넘어 무한 증가함"


@pytest.mark.asyncio
async def test_slot_contextmanager_bounds_active():
    async def hold():
        async with manager.rpa_slot():
            return manager._active

    # 슬롯 안에서 active는 최소 1, 끝나면 0으로 반납
    v = await hold()
    assert v >= 1
    assert manager._active == 0
