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
    """gov24 성공 판정이 '실제 발급 신호(really_issued)'로만 이뤄지는지 소스 계약 고정.
    - 파일 저장(saved)만으로 done+success=True 되면 안 된다(원래 방지 의도 유지).
    - 반대로, headed 저장이 구조적으로 실패해도 really_issued 면 성공은 유지돼야 한다(감사 :567) →
      성공 게이트는 'really_issued 단독'. (과거 'really_issued and saved' 는 저장실패가 실제 성공을 뒤집던 결함.)"""
    src = open("rpa/gov24_rpa.py", encoding="utf-8").read()
    # really_issued 는 실제 페이지 신호(처리완료/발급완료/mbrAplySrvcList)로 계산돼야 한다
    assert "really_issued = " in src
    assert "처리완료" in src and "mbrAplySrvcList" in src
    # 성공 분기는 really_issued 단독 게이트 — 저장 실패가 발급 성공을 뒤집지 않게
    assert "if really_issued:" in src
    # saved 를 발급신호에 OR 로 섞어 '저장만으로 성공' 되던 옛 코드가 없어야 함
    assert 'or bool(saved)' not in src
    assert "really_issued and saved" not in src


def test_work24_reports_incomplete_when_button_not_reached():
    """work24 가 발급버튼 미도달 시 success=False 로 보고하는 계약 고정."""
    src = open("rpa/work24_rpa.py", encoding="utf-8").read()
    assert "issue_reached" in src
    assert '"success": False' in src


# ── PII 방어 회귀(감사 확정): 교차사용자 서류첨부·리셋·토큰 안전 ──

def test_recent_issued_docs_recency_filter(monkeypatch, tmp_path):
    """within_seconds: 오래된(직전 사용자) 발급물은 자동첨부 후보에서 제외 — 교차사용자 PII 차단."""
    import os
    import time
    from rpa import base
    monkeypatch.setattr(base, "DOCS_DIR", tmp_path)
    old = tmp_path / "주민등록등본_20260101_000000.pdf"
    new = tmp_path / "가족관계증명서_20260712_000000.pdf"
    old.write_bytes(b"%PDF old"); new.write_bytes(b"%PDF new")
    # old 파일 mtime 을 2시간 전으로
    past = time.time() - 7200
    os.utime(old, (past, past))
    within = base.recent_issued_docs(within_seconds=1200)  # 20분 이내만
    names = [n for n, _ in within]
    assert "가족관계증명서" in names          # 최근 발급물은 포함
    assert "주민등록등본" not in names         # 2시간 전(직전 사용자)은 제외
    # 필터 없으면 둘 다
    assert len(base.recent_issued_docs()) == 2


def test_clear_docs_dir_removes_pii(monkeypatch, tmp_path):
    """'다음 분 상담' 리셋 시 서버 발급 문서(주민번호 PDF)를 전부 삭제."""
    import os
    from rpa import base
    monkeypatch.setattr(base, "DOCS_DIR", tmp_path)
    (tmp_path / "a.pdf").write_bytes(b"x")
    (tmp_path / "b.png").write_bytes(b"x")
    (tmp_path / "keep.txt").write_text("not a doc")  # PDF/PNG 만 대상
    n = base.clear_docs_dir()
    assert n == 2
    assert not (tmp_path / "a.pdf").exists() and not (tmp_path / "b.png").exists()
    assert (tmp_path / "keep.txt").exists()  # 문서 외 파일은 유지


def test_token_ok_non_ascii_and_edge():
    """token_ok: 비ASCII·None·불일치는 False(예외 없이), 정확 일치만 True."""
    from rpa.manager import token_ok
    assert token_ok("한글토큰", "한글토큰") is True       # 비ASCII 일치도 정상 True(500 안 남)
    assert token_ok("한글토큰", "다른값") is False
    assert token_ok("", "x") is False
    assert token_ok("x", "") is False
    assert token_ok(None, "x") is False
    assert token_ok("x", None) is False
    assert token_ok("tok123", "tok123") is True
