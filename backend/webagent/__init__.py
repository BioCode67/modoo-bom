# -*- coding: utf-8 -*-
"""backend/webagent — 자연어 목표를 받아 정부/공공 사이트 자동화를 수행하는 스마트 AI 웹 에이전트.

기존 하드코딩 매크로(local_agent/rpa)를 '결정층(browser-use 등 에이전트) + 실행층(검증된 빠른경로)'
하이브리드로 감싼 오케스트레이션 계층. 공개 API는 아래 4가지만 알면 된다.

    from webagent import run_web_agent, WebAgentConfig, WebAgentResult

    result = await run_web_agent("주민등록등본 발급")
    print(result.to_json())   # {"goal": "...", "success": ..., "status": "...", ...}

가드레일: max_steps(기본 15) · timeout(기본 180s) · 실패 시 공식 링크 폴백(거짓 성공 금지).
"""
from webagent.config import WebAgentConfig  # noqa: F401
from webagent.types import WebAgentResult  # noqa: F401
from webagent.web_agent import (  # noqa: F401
    run_web_agent,
    DefaultExecutor,
    EngineOutcome,
    default_fallback_url,
    default_resolver,
)

__all__ = [
    "run_web_agent",
    "WebAgentConfig",
    "WebAgentResult",
    "DefaultExecutor",
    "EngineOutcome",
    "default_fallback_url",
    "default_resolver",
]
