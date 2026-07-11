"""RPA 정직성 회귀 — 발급 실패를 '완료'로 오보하지 않는지 고정(감사 확정 결함).

실브라우저 없이, 성공 판정 분기의 계약만 검증:
- gov24: 실제 발급신호(처리완료/mbrAplySrvcList) 없이 파일만 저장되면 success=False·saved_path 없음
- 타임아웃 핸들러: 이미 done 인 태스크를 error 로 덮지 않음
"""
import asyncio

from rpa import manager


class _Task:
    def __init__(self, status="running"):
        self.status = status
        self.updates = []
        self.task_id = "honesty-test"

    def update(self, status, step, screenshot=None):
        self.status = status
        self.updates.append((status, step))

    def to_dict(self):
        return {"task_id": self.task_id, "status": self.status}


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


def test_timeout_does_not_overwrite_done(monkeypatch):
    """유예 sleep 중 타임아웃이 발급 성공(done)을 error 로 덮어쓰지 않는다."""
    monkeypatch.setattr(manager, "_sem", None)
    monkeypatch.setattr(manager, "_MAX_CONCURRENT", 1)
    monkeypatch.setattr(manager, "_active", 0)
    monkeypatch.setattr(manager, "_waiting", 0)
    monkeypatch.setattr(manager, "_TASK_TIMEOUT", 0.05)
    monkeypatch.setattr(manager, "_rpa_tasks", {})
    task = _Task()

    async def slow_but_done():
        task.update("done", "발급 완료")  # 성공 도달
        await asyncio.sleep(0.3)          # 유예 sleep 중 타임아웃 발생

    _run(manager._guarded_run(task, slow_but_done))
    assert task.status == "done"  # error 로 덮이지 않음
    assert not any(s == "error" for s, _ in task.updates)


def test_timeout_marks_error_when_not_done(monkeypatch):
    """아직 완료 전이면 타임아웃은 정상적으로 error 로 표기."""
    monkeypatch.setattr(manager, "_sem", None)
    monkeypatch.setattr(manager, "_MAX_CONCURRENT", 1)
    monkeypatch.setattr(manager, "_active", 0)
    monkeypatch.setattr(manager, "_waiting", 0)
    monkeypatch.setattr(manager, "_TASK_TIMEOUT", 0.05)
    monkeypatch.setattr(manager, "_rpa_tasks", {})
    task = _Task()

    async def stuck():
        await asyncio.sleep(0.3)

    _run(manager._guarded_run(task, stuck))
    assert task.status == "error"


def test_gov24_success_branch_requires_real_signal():
    """gov24 성공 판정이 'really_issued and saved'로 이뤄지는지 소스 계약 고정
    (파일 저장만으로 done+success=True 되던 결함 방지 — 리터럴 grep)."""
    src = open("rpa/gov24_rpa.py", encoding="utf-8").read()
    assert "really_issued and saved" in src
    # bool(saved) 를 발급신호에 OR 로 섞던 옛 코드가 없어야 함
    assert 'or bool(saved)' not in src


def test_work24_reports_incomplete_when_button_not_reached():
    """work24 가 발급버튼 미도달 시 success=False 로 보고하는 계약 고정."""
    src = open("rpa/work24_rpa.py", encoding="utf-8").read()
    assert "issue_reached" in src
    assert '"success": False' in src
