# -*- coding: utf-8 -*-
"""webagent REST 라우터 — 순수 핸들러 계약 테스트(HTTP 계층 없이, TestClient 불필요).

가드레일 클램프·엔진 검증·구조화 결과·정직한 가용성 보고를 고정한다.
"""
import asyncio

from webagent.router import (
    _handle_run,
    _handle_journey,
    _config_info,
    _cfg_from,
    RunRequest,
    JourneyRequest,
)


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


def test_cfg_from_clamps_guardrails():
    cfg = _cfg_from({"max_steps": 999, "timeout_s": 9999})
    assert cfg.max_steps == 50           # 상한 클램프(무한 루프 방지)
    assert cfg.timeout_s == 600.0        # 상한 클램프
    # 음수·0은 무시하고 기본값 유지
    d = _cfg_from({"max_steps": -5, "timeout_s": 0})
    assert d.max_steps == 15 and d.timeout_s == 180.0


def test_cfg_from_validates_engine():
    assert _cfg_from({"engine": "browser_use"}).engine == "browser_use"
    assert _cfg_from({"engine": "nonsense"}).engine == "auto"   # 미지원 → 기본


def test_config_info_reports_honest_availability():
    info = _config_info()
    assert info["config"]["max_steps"] == 15
    assert set(info["availability"]) == {"browser_use", "builtin_cdp", "llm_provider"}
    # 개발환경: 미설치·크롬 없음·키 없음 → 정직하게 False/none
    assert info["availability"]["browser_use"] is False
    assert info["availability"]["builtin_cdp"] is False
    assert info["availability"]["llm_provider"] == "none"
    assert "auto" in info["valid_engines"]


def test_handle_run_known_doc_routes():
    out = _run(_handle_run({"goal": "주민등록등본 발급"}))
    assert out["engine"] == "deterministic"
    assert out["status"] == "route"
    assert out["extracted"]["resolved_doc"] == "주민등록등본"


def test_handle_run_unknown_falls_back():
    out = _run(_handle_run({"goal": "처음 보는 어떤 신청"}))
    assert out["success"] is False
    assert out["status"] == "fallback"
    assert out["fallback_url"]


def test_handle_run_empty_goal_is_error():
    out = _run(_handle_run({"goal": "   "}))
    assert out["status"] == "error" and out["success"] is False


def test_handle_journey_aggregates():
    out = _run(_handle_journey({"goals": ["주민등록등본 발급", "처음 보는 신청"]}))
    assert len(out["steps"]) == 2
    assert out["routed_count"] == 1     # 등본은 라우팅
    assert out["error_count"] == 1      # 미지원은 폴백
    assert out["summary"]


def test_handle_journey_bad_goals_type_is_safe():
    out = _run(_handle_journey({"goals": "not-a-list"}))
    assert out["steps"] == []


def test_request_schemas_defaults():
    r = RunRequest(goal="등본")
    assert r.goal == "등본" and r.engine is None
    j = JourneyRequest(goals=["a", "b"])
    assert j.stop_on_human is True and j.goals == ["a", "b"]
