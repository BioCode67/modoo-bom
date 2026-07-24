# -*- coding: utf-8 -*-
"""webagent — 스마트 AI 웹 에이전트 오케스트레이션 계약 테스트.

브라우저·LLM 키 없이 도는 순수 로직 검증(가드레일·라우팅·롤백·구조화 결과·정직성).
실제 browser-use 구동은 데스크탑 고정 버전에서, 여기선 '앱을 죽이지 않고 정직하게 축소'를 고정한다.
"""
import asyncio
import os

import pytest

from webagent import (
    run_web_agent,
    WebAgentConfig,
    WebAgentResult,
    DefaultExecutor,
    EngineOutcome,
    default_resolver,
    default_fallback_url,
)
from webagent.types import (
    STATUS_DONE,
    STATUS_ROUTE,
    STATUS_FALLBACK,
    STATUS_ERROR,
    STATUS_HUMAN_AUTH,
    STATUS_HUMAN_SUBMIT,
)
from webagent.web_agent import _browser_use_available, _cdp_reachable


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


# ── 설정·가드레일 ────────────────────────────────────────────────────────────
def test_config_defaults_guardrails():
    c = WebAgentConfig.from_env()
    assert c.max_steps == 15      # 무한 루프 안전장치 기본값
    assert c.timeout_s == 180.0   # 전체 타임아웃 기본값
    assert c.engine == "auto"
    assert c.use_vision is True


def test_config_env_override(monkeypatch):
    monkeypatch.setenv("WEBAGENT_MAX_STEPS", "8")
    monkeypatch.setenv("WEBAGENT_TIMEOUT", "42")
    monkeypatch.setenv("WEBAGENT_ENGINE", "browser_use")
    monkeypatch.setenv("WEBAGENT_VISION", "0")
    c = WebAgentConfig.from_env()
    assert c.max_steps == 8 and c.timeout_s == 42.0
    assert c.engine == "browser_use" and c.use_vision is False


def test_config_rejects_bad_values(monkeypatch):
    monkeypatch.setenv("WEBAGENT_MAX_STEPS", "-3")   # 음수 → 기본값
    monkeypatch.setenv("WEBAGENT_ENGINE", "nonsense")  # 미지원 → auto
    c = WebAgentConfig.from_env()
    assert c.max_steps == 15 and c.engine == "auto"


# ── 입력 검증·구조화 결과 계약 ───────────────────────────────────────────────
def test_empty_goal_is_error():
    r = _run(run_web_agent("   "))
    assert isinstance(r, WebAgentResult)
    assert r.success is False and r.status == STATUS_ERROR
    assert r.fallback_url  # 폴백 링크는 항상 채워 정직 안내


def test_result_json_contract():
    r = _run(run_web_agent("아무 목표", resolver=lambda g: None))
    d = r.to_dict()
    for k in ("goal", "success", "status", "engine", "steps", "extracted",
              "message", "fallback_url", "needs_human", "error"):
        assert k in d
    import json
    assert json.loads(r.to_json())["status"] == d["status"]


# ── 결정적 빠른경로(라우팅) ──────────────────────────────────────────────────
def test_deterministic_route_via_resolver():
    r = _run(run_web_agent("주민등록등본 발급", resolver=lambda g: "주민등록등본"))
    assert r.engine == "deterministic" and r.status == STATUS_ROUTE
    assert r.extracted["resolved_doc"] == "주민등록등본"
    assert r.extracted["path"] == "deterministic"
    # 라우팅은 '완료'가 아니다(실행은 검증된 흐름의 몫) — 거짓 성공 금지
    assert r.success is False


def test_deterministic_engine_forced_unknown_falls_back():
    cfg = WebAgentConfig(engine="deterministic")
    r = _run(run_web_agent("처음 보는 것", resolver=lambda g: None, config=cfg))
    # 결정적 강제인데 못 알아보면 에이전트로 승격하지 않고 정직 폴백
    assert r.status == STATUS_FALLBACK and r.engine == "none"


def test_default_resolver_bridges_local_agent():
    # local_agent.resolve_doc 실브리지 — 아는 서류는 정규화, 모호/미지원은 None
    assert default_resolver("등본") == "주민등록등본"
    assert default_resolver("존재하지않는서류xyz") is None


# ── 에이전트 경로(주입 엔진) ─────────────────────────────────────────────────
def test_agent_done_success_structured():
    async def fake(goal, cfg):
        return EngineOutcome(handled=True, success=True, status=STATUS_DONE,
                             engine="browser_use", steps=9, extracted={"final": "OK"})
    ex = DefaultExecutor(browser_use_runner=fake)
    r = _run(run_web_agent("처음 보는 서류 발급", resolver=lambda g: None, executor=ex))
    assert r.success is True and r.status == STATUS_DONE
    assert r.engine == "browser_use" and r.steps == 9 and r.extracted["final"] == "OK"


def test_agent_exception_rolls_back_to_fallback():
    async def boom(goal, cfg):
        raise RuntimeError("사이트 응답 없음")
    ex = DefaultExecutor(browser_use_runner=boom)
    r = _run(run_web_agent("처음 보는 서류", resolver=lambda g: None, executor=ex))
    assert r.success is False and r.status == STATUS_FALLBACK
    assert r.fallback_url  # 실패해도 갈 곳을 준다


def test_agent_timeout_guardrail():
    async def slow(goal, cfg):
        await asyncio.sleep(3)
        return EngineOutcome(handled=True, success=True, status=STATUS_DONE, engine="browser_use")
    ex = DefaultExecutor(browser_use_runner=slow)
    cfg = WebAgentConfig(timeout_s=0.15)
    r = _run(run_web_agent("느린 사이트", resolver=lambda g: None, executor=ex, config=cfg))
    assert r.status == STATUS_ERROR and r.error == "timeout"


def test_human_auth_escalates_status():
    async def auth(goal, cfg):
        return EngineOutcome(handled=True, success=False, status=STATUS_ROUTE,
                             engine="browser_use", needs_human="auth")
    ex = DefaultExecutor(browser_use_runner=auth)
    r = _run(run_web_agent("자격득실 발급", resolver=lambda g: None, executor=ex))
    assert r.status == STATUS_HUMAN_AUTH and r.needs_human == "auth"
    assert r.success is False  # 인증은 사람 몫 — 완료 아님


def test_human_submit_not_marked_done():
    async def submit(goal, cfg):
        return EngineOutcome(handled=True, success=False, status=STATUS_ROUTE,
                             engine="browser_use", needs_human="submit")
    ex = DefaultExecutor(browser_use_runner=submit)
    r = _run(run_web_agent("복지 신청", resolver=lambda g: None, executor=ex))
    assert r.status == STATUS_HUMAN_SUBMIT and r.success is False


def test_engine_rollback_chain_bu_then_builtin():
    # browser_use 실패 → builtin 으로 롤백(둘 다 주입) 후 성공
    async def bu_fail(goal, cfg):
        raise RuntimeError("bu down")

    async def builtin_ok(goal, cfg):
        return EngineOutcome(handled=True, success=True, status=STATUS_DONE, engine="builtin", steps=3)

    # builtin 준비 판정을 우회하기 위해 _ready 를 몽키패치 대신, cdp 미도달 환경에선 builtin 이
    # 준비 안 됨 → 아래는 '주입 러너가 있어도 cdp 없으면 스킵'을 함께 검증한다.
    ex = DefaultExecutor(browser_use_runner=bu_fail, builtin_runner=builtin_ok)
    r = _run(run_web_agent("처음 보는 것", resolver=lambda g: None, executor=ex))
    # 개발환경엔 CDP 크롬이 없어 builtin 은 준비 안 됨 → bu 실패 후 정직 폴백
    assert r.status == STATUS_FALLBACK


# ── 정직성: 개발환경에선 실엔진이 준비되지 않아야(거짓 성공 방지) ─────────────
def test_no_engine_available_in_dev_is_honest_fallback():
    # 실제 DefaultExecutor(주입 없음) — browser_use 미설치 + CDP 없음 → 폴백
    r = _run(run_web_agent("처음 보는 신청", resolver=lambda g: None))
    assert r.success is False and r.status == STATUS_FALLBACK


def test_browser_use_unavailable_without_package_or_key():
    assert _browser_use_available() is False
    assert _cdp_reachable() is False


def test_fallback_url_routing():
    assert default_fallback_url("주민등록등본 발급") == "https://www.gov.kr"
    assert default_fallback_url("청년월세 신청") == "https://www.bokjiro.go.kr"


# ── browser-use 결과 추출(_extract_browser_use_result) — 버전 관용 방어 파싱 고정 ──
from webagent.web_agent import _extract_browser_use_result  # noqa: E402


class _FakeHist:
    """browser-use 히스토리의 다양한 버전 모양을 흉내낸다(있는 메서드만)."""
    def __init__(self, done=None, final=None, steps=None):
        if done is not None:
            self.is_done = lambda: done
        if final is not None:
            self.final_result = lambda: final
        if steps is not None:
            self.number_of_steps = lambda: steps


def test_extract_done_with_final_and_steps():
    done, text, extracted, steps = _extract_browser_use_result(_FakeHist(done=True, final="발급완료", steps=5))
    assert done is True
    assert text == "발급완료"
    assert extracted == {"final": "발급완료"}
    assert steps == 5


def test_extract_not_done_defaults():
    done, text, extracted, steps = _extract_browser_use_result(_FakeHist(done=False))
    assert done is False and text == "" and extracted == {} and steps == 0


def test_extract_missing_methods_no_crash():
    # is_done/final_result/number_of_steps 가 아예 없는 객체(다른 버전) — 크래시 없이 기본값
    done, text, extracted, steps = _extract_browser_use_result(object())
    assert done is False and text == "" and extracted == {} and steps == 0


def test_extract_final_result_none_is_empty():
    # final_result가 있으나 None을 돌려주는 경우(미완) — 빈 텍스트
    done, text, extracted, steps = _extract_browser_use_result(_FakeHist(done=False, final=None, steps=3))
    assert text == "" and steps == 3
