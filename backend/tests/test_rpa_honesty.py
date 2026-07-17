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


def test_nhis_success_gates_on_completion_not_save():
    """nhis 성공 판정이 '저장(saved)'이 아니라 '완료 신호(completed)'로만 이뤄지는지 계약 고정.
    save_document 는 어떤 화면이든 저장(스샷 폴백)하므로, 저장 성공을 발급 성공으로 쓰면 미발급 화면도
    '발급 완료!'로 오보된다(감사 HIGH). 성공 게이트는 completed(출력/완료화면) 단독이어야 한다."""
    src = open("rpa/nhis_rpa.py", encoding="utf-8").read()
    assert "completed = printed or len(context.pages) > 1" in src
    assert "if completed:" in src
    # 옛 'if saved:' 성공 분기(저장만으로 성공 오보)가 남아있으면 안 된다
    assert "if saved:" not in src
    # 저장 조건에서 옛 'completed or issued'(버튼 클릭만으로 저장) 제거 — completed 일 때만 저장
    assert "completed or issued" not in src


def test_gov24_and_nhis_do_not_save_when_unissued():
    """미발급 화면은 저장하지 않는다 — recent_issued_docs 는 DOCS_DIR 를 '파일명 글롭'으로 스캔해
    신청서 자동첨부 후보를 만들므로, 미발급 '진행 화면 캡처'를 저장하면 발급물처럼 신청서에 붙는다(감사 HIGH)."""
    gov = open("rpa/gov24_rpa.py", encoding="utf-8").read()
    # gov24: save_document 호출이 really_issued 조건부(미발급이면 저장 안 함)
    assert "if really_issued else" in gov
    # 미발급 분기에 옛 progress_capture(저장 파일 참조)가 없어야 한다
    assert "progress_capture" not in gov
    nhis = open("rpa/nhis_rpa.py", encoding="utf-8").read()
    # nhis: 저장은 completed 블록 안에서만 수행돼야 한다(미발급 else 에서 저장 없음)
    assert "if completed:\n                saved = await save_document" in nhis


def test_journey_success_from_result_not_status():
    """여정 성공 판정이 '단계 status=done' 이 아니라 '단계 result.success' 로 이뤄지는지 계약 고정 —
    미발급인데 done(⚠️)으로 끝난 단계까지 '완료'로 세던 오보(감사) 방지."""
    src = open("rpa/orchestrator.py", encoding="utf-8").read()
    assert 'step["success"] = bool(r.get("success"))' in src
    assert 'ok = any(s.get("success") for s in j["steps"])' in src
    # 옛 status 기반 ok 계산이 남아있으면 안 된다
    assert 'any(s["status"] in ("done", "completed") for s in j["steps"])' not in src


def test_journey_uses_bounded_cleanup_not_wait_for():
    """여정 단계 실행이 wait_for(무한 정리 슬롯누수) 대신 asyncio.wait+유계정리 패턴을 쓰는지 계약 고정(감사).
    또 하드취소가 '지금 도는' 단계를 정확히 지목하도록 current_task_id 를 세팅한다."""
    src = open("rpa/orchestrator.py", encoding="utf-8").read()
    assert "asyncio.wait_for(_run_step_doc" not in src
    assert "asyncio.wait_for(run_apply_rpa" not in src
    assert "await asyncio.wait({inner}, timeout=_TASK_TIMEOUT)" in src
    assert 'j["current_task_id"] = task.task_id' in src


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


# ── 안전 최상위: 복지 신청 '최종 제출'은 에이전트가 절대 대리하지 않는다(human-in-the-loop) ──

def test_apply_never_clicks_final_welfare_submit():
    """복지 신청의 '최종 제출'(제출/신청완료)은 비가역·법적 행위라 에이전트가 절대 누르지 않는다
    (CLAUDE.md 설계원칙 '완전 무인 자동 제출은 설계상 불가'). apply_rpa 는 제출 셀렉터(SUBMIT_SELECTORS)를
    정의만 하고 '어떤 click 호출에도 넘기지 않아야' 한다 — 이 계약이 깨지면 사용자 동의·본인인증 없이
    정부에 법적 신청서가 제출될 수 있다(가장 위험한 회귀). 최종 제출은 오직 사람이 확인 후 직접."""
    src = open("rpa/apply_rpa.py", encoding="utf-8").read()
    assert "SUBMIT_BUTTON_SELECTORS" in src        # 정의는 존재(향후 '제출 위치 안내'용으로만 보존)
    # 제출 셀렉터는 정의(=) 라인에서만 등장하고, 어떤 click/매칭 호출에도 넘기면 안 된다.
    uses = [ln.strip() for ln in src.splitlines() if "SUBMIT_BUTTON_SELECTORS" in ln]
    assert len(uses) == 1 and uses[0].startswith("SUBMIT_BUTTON_SELECTORS ="), \
        f"제출 셀렉터가 정의 외에 사용됨(안전 위반): {uses}"
    # 대리 제출 안 함 설계 의도가 코드에 명시돼 있어야 한다
    assert ("의도적 미사용" in src) or ("누르지 않" in src) or ("human-in-the-loop" in src.lower())


def test_journey_orders_docs_before_applications():
    """완전자동화 연쇄(한 번 인증 → 여러 서류 발급 → 신청서 자동첨부)가 성립하려면, 여정은 모든 '서류 발급'을
    모든 '복지 신청'보다 먼저 실행해야 한다 — 신청 단계의 자동첨부(recent_issued_docs)가 '방금 발급한' 서류를
    찾을 수 있게. 순서가 뒤집히면 서류가 아직 없어 자동첨부가 비고, 사용자가 수동 첨부해야 한다(자동화 저하)."""
    from rpa.orchestrator import _new_journey, _journeys
    jid = _new_journey(["주민등록등본", "소득금액증명"], ["기초연금", "주거급여"], "테스트")
    steps = _journeys[jid]["steps"]
    doc_idx = [i for i, s in enumerate(steps) if s["kind"] == "doc"]
    apply_idx = [i for i, s in enumerate(steps) if s["kind"] == "apply"]
    assert doc_idx and apply_idx
    assert max(doc_idx) < min(apply_idx), f"서류가 신청보다 먼저여야 자동첨부 성립: {[(s['kind'], s['name']) for s in steps]}"
    _journeys.pop(jid, None)  # 테스트 정리


def test_smart_agent_guard_is_wired_before_execute():
    """지능형 에이전트(smart_agent) 안전 계약 — 프롬프트만 믿지 않고 '실행 직전 코드 게이트'로 강제한다(감사 S1).
    guard_action 이 정의돼 있고, run_smart 루프가 execute 전에 반드시 호출해야 한다.
    (동작 자체는 test_smart_agent.py 의 guard_action 행위 테스트가 검증 — 이 테스트는 '배선'을 고정)"""
    src = open("smart_agent.py", encoding="utf-8").read()
    assert "human_auth" in src and "human_submit" in src
    assert "_BLOCK" in src and "_SUBMIT" in src
    # ⚠️ 문자열 grep만이던 약한 계약 보강 — 게이트가 '정의'되고 '실행 전 호출'되는지 확인
    assert "def guard_action" in src, "실행 직전 안전 게이트가 정의돼야 함"
    assert "guard_action(action, elements, page.url)" in src, "execute 전에 guard_action 호출돼야 함"
    # 게이트 '호출'이 execute '호출'보다 소스상 먼저 나와야(방어 순서) — 정의가 아니라 호출부로 비교
    assert src.index("guard_action(action, elements, page.url)") < src.index("result = execute(action"), \
        "게이트 호출이 execute 호출 이전에 배선돼야"


def test_journey_accepts_verified_deeplink_services(monkeypatch):
    """여정 서비스 수락이 단건 신청과 정합 — 청년월세지원(SERVICE_APPLY_URLS 실측 딥링크)이 여정에서
    탈락하지 않는다('발급→신청' 원클릭 연쇄의 성립 조건). 미검증 서비스는 여전히 거절."""
    from rpa import orchestrator
    spawned = []
    monkeypatch.setattr("rpa.manager._spawn_bg", lambda coro: (spawned.append(1), coro.close()))
    jid, docs, svcs = orchestrator.start_journey(
        ["주민등록등본"], ["청년월세지원", "존재하지않는서비스"], "테스트", {}, {})
    assert "청년월세지원" in svcs           # 실측 딥링크 보유 → 수락
    assert "존재하지않는서비스" not in svcs   # 미검증 → 거절
    assert docs == ["주민등록등본"] and spawned
    # 단일 서비스 + 검증된 복지로 딥링크(profile.apply_url) 일반화 수락
    jid2, _, svcs2 = orchestrator.start_journey(
        [], ["희귀서비스"], "테스트", {},
        {"apply_url": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00009999"})
    assert svcs2 == ["희귀서비스"]
    # 딥링크 없는 미지 서비스는 거절
    jid3, _, svcs3 = orchestrator.start_journey([], ["희귀서비스"], "테스트", {}, {})
    assert svcs3 == []
