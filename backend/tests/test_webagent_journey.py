# -*- coding: utf-8 -*-
"""webagent 여정(run_web_journey) — 다목표 연쇄 오케스트레이션 계약 테스트.

브라우저·키 없이 도는 순수 로직 검증(집계·사람인계 중단·정직한 요약).
"""
import asyncio

from webagent import run_web_journey, WebJourneyResult, DefaultExecutor, EngineOutcome
from webagent.types import STATUS_DONE, STATUS_ROUTE, STATUS_HUMAN_AUTH


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


def test_empty_goals_is_safe():
    r = _run(run_web_journey([]))
    assert isinstance(r, WebJourneyResult)
    assert r.steps == [] and r.summary  # 요약은 항상 채운다
    assert r.done_count == 0 and r.stopped_at is None


def test_known_docs_all_routed():
    # 결정적 리졸버로 두 목표 모두 '경로 확정'(route) — 실제 발급은 별도(정직성)
    r = _run(run_web_journey(["주민등록등본 발급", "가족관계증명서 발급"],
                             resolver=lambda g: "주민등록등본" if "등본" in g else "가족관계증명서"))
    assert len(r.steps) == 2
    assert r.routed_count == 2 and r.done_count == 0
    assert all(s["engine"] == "deterministic" for s in r.steps)
    assert r.stopped_at is None


def test_agent_done_steps_counted():
    async def done_runner(goal, cfg):
        return EngineOutcome(handled=True, success=True, status=STATUS_DONE, engine="browser_use", steps=3)
    ex = DefaultExecutor(browser_use_runner=done_runner)
    r = _run(run_web_journey(["처음 보는 서류 A", "처음 보는 서류 B"], resolver=lambda g: None, executor=ex))
    assert r.done_count == 2 and r.summary.startswith("목표 2개")


def test_stops_at_first_human_step():
    # 첫 목표는 사람 인증 필요 → 그 지점에서 멈추고 stopped_at 기록(정부 인증 대리 불가)
    async def auth_runner(goal, cfg):
        return EngineOutcome(handled=True, success=False, status=STATUS_ROUTE,
                             engine="browser_use", needs_human="auth")
    ex = DefaultExecutor(browser_use_runner=auth_runner)
    r = _run(run_web_journey(["A", "B", "C"], resolver=lambda g: None, executor=ex))
    assert r.stopped_at == 0
    assert len(r.steps) == 1                 # 뒤 목표는 실행하지 않음
    assert r.human_count == 1
    assert r.steps[0]["status"] == STATUS_HUMAN_AUTH


def test_continue_through_human_when_disabled():
    async def auth_runner(goal, cfg):
        return EngineOutcome(handled=True, success=False, status=STATUS_ROUTE,
                             engine="browser_use", needs_human="auth")
    ex = DefaultExecutor(browser_use_runner=auth_runner)
    r = _run(run_web_journey(["A", "B"], resolver=lambda g: None, executor=ex, stop_on_human=False))
    assert r.stopped_at is None and len(r.steps) == 2 and r.human_count == 2


def test_blank_goals_filtered():
    r = _run(run_web_journey(["  ", "", "주민등록등본"], resolver=lambda g: "주민등록등본" if g.strip() else None))
    assert len(r.steps) == 1 and r.routed_count == 1


def test_summary_and_json_contract():
    r = _run(run_web_journey(["등본"], resolver=lambda g: "주민등록등본"))
    d = r.to_dict()
    for k in ("goals", "steps", "done_count", "routed_count", "human_count", "error_count", "stopped_at", "summary"):
        assert k in d
    assert "경로 확정" in d["summary"]


def test_fallback_steps_counted_as_error():
    # 리졸버 미인식 + 엔진 없음(개발환경) → 폴백 → error_count 집계
    r = _run(run_web_journey(["처음 보는 신청"], resolver=lambda g: None))
    assert r.error_count == 1 and r.done_count == 0
