"""manager 다중 사용자 안전장치 회귀 — 감사 지적 2건 고정.

1) _evict_old 가 '진행 중' 태스크를 지우지 않는다(폴링 중 404 방지).
2) queued_slot 이 슬롯 대기 동안 _waiting 을 올려 can_accept() 백프레셔가 여정을 인지한다.
"""
import asyncio

from rpa import manager


def _mk(status: str, created: str) -> dict:
    return {"status": status, "created_at": created}


def test_evict_skips_running(monkeypatch):
    monkeypatch.setattr(manager, "_MAX_TASKS", 50)  # 하한이 50이라 그대로 사용
    monkeypatch.setattr(manager, "_rpa_tasks", {})
    store = manager._rpa_tasks
    # 오래된 순서: running 3개(가장 오래됨) → done 60개
    for i in range(3):
        store[f"run{i}"] = _mk("running", f"2026-07-11T00:00:0{i}")
    for i in range(60):
        store[f"done{i}"] = _mk("done", f"2026-07-11T01:00:{i:02d}")
    manager._evict_old()
    # 진행 중은 가장 오래됐어도 전부 생존
    assert all(f"run{i}" in store for i in range(3))
    # 초과분은 '끝난' 것 중 오래된 것부터 제거됨(총량 상한 준수)
    assert len(store) == 50


def test_evict_noop_under_limit(monkeypatch):
    monkeypatch.setattr(manager, "_rpa_tasks", {"a": _mk("done", "t")})
    manager._evict_old()
    assert "a" in manager._rpa_tasks


def test_queued_slot_counts_waiting(monkeypatch):
    """동시성 1로 좁힌 뒤, 두 번째 진입이 대기하는 동안 _waiting 이 1이 되는지 관찰."""
    monkeypatch.setattr(manager, "_sem", None)
    monkeypatch.setattr(manager, "_MAX_CONCURRENT", 1)
    monkeypatch.setattr(manager, "_active", 0)
    monkeypatch.setattr(manager, "_waiting", 0)
    observed = []

    async def hold(release: asyncio.Event):
        async with manager.queued_slot():
            await release.wait()

    async def probe(release: asyncio.Event):
        await asyncio.sleep(0.05)  # 두 번째 태스크가 대기열에 들어갈 시간
        observed.append(manager._waiting)
        release.set()

    async def second():
        async with manager.queued_slot():
            pass

    async def run():
        release = asyncio.Event()
        await asyncio.gather(hold(release), second(), probe(release))

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(run())
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())
    assert observed == [1]      # 대기 중엔 백프레셔에 잡힘
    assert manager._waiting == 0  # 종료 후 원상복구
    assert manager._active == 0
