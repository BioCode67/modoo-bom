# -*- coding: utf-8 -*-
"""웹 에이전트 REST 라우터 — 자연어 목표를 받아 구조화 결과(JSON)를 돌려주는 엔드포인트.

main.py 에서 `app.include_router(webagent_router)` 로 연결한다. 실제 브라우저 구동은 러너에
위임되므로, 브라우저·키가 없는 서버/데모 환경에선 검증된 빠른경로 라우팅 + 공식 링크 폴백으로
정직하게 축소된다(거짓 성공 없음). 핸들러 로직은 순수 async 함수로 분리해 HTTP 계층 없이도 테스트한다.

엔드포인트:
  POST /api/webagent/run      { goal, engine?, max_steps?, timeout_s? } → WebAgentResult
  POST /api/webagent/journey  { goals[], engine?, stop_on_human? }      → WebJourneyResult
  GET  /api/webagent/config   현재 가드레일 기본값 + 엔진 가용성
"""
from __future__ import annotations

from dataclasses import replace
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from webagent import run_web_agent, run_web_journey, WebAgentConfig
from webagent.config import VALID_ENGINES
from webagent.web_agent import _browser_use_available, _cdp_reachable, default_resolver, default_fallback_url
from webagent.llm_factory import select_provider

# 목표 성격 분류용 키워드(브라우저 없이 빠른 미리보기)
_ISSUE_WORDS = ("발급", "떼", "출력", "증명서", "등본", "초본", "확인서", "내역서")
_APPLY_WORDS = ("신청", "접수", "지원금", "수당", "급여", "바우처")


# ── 요청 스키마 ──
class RunRequest(BaseModel):
    goal: str
    engine: Optional[str] = None
    max_steps: Optional[int] = None
    timeout_s: Optional[float] = None
    use_vision: Optional[bool] = None


class JourneyRequest(BaseModel):
    goals: list[str]
    engine: Optional[str] = None
    max_steps: Optional[int] = None
    timeout_s: Optional[float] = None
    stop_on_human: bool = True


def _cfg_from(payload: dict) -> WebAgentConfig:
    """env 기본값에 요청 오버라이드를 안전하게(가드레일 범위로 클램프) 얹은 설정을 만든다."""
    cfg = WebAgentConfig.from_env()
    engine = payload.get("engine")
    if isinstance(engine, str) and engine in VALID_ENGINES:
        cfg = replace(cfg, engine=engine)
    ms = payload.get("max_steps")
    if isinstance(ms, int) and ms > 0:
        cfg = replace(cfg, max_steps=max(1, min(50, ms)))  # 무한 루프 방지 상한
    ts = payload.get("timeout_s")
    if isinstance(ts, (int, float)) and ts > 0:
        cfg = replace(cfg, timeout_s=float(max(1, min(600, ts))))
    uv = payload.get("use_vision")
    if isinstance(uv, bool):
        cfg = replace(cfg, use_vision=uv)
    return cfg


# ── 순수 핸들러(HTTP 없이 테스트 가능) ──
async def _handle_run(payload: dict) -> dict:
    goal = (payload.get("goal") or "").strip()
    cfg = _cfg_from(payload)
    result = await run_web_agent(goal, config=cfg)
    return result.to_dict()


async def _handle_journey(payload: dict) -> dict:
    goals = payload.get("goals") or []
    if not isinstance(goals, list):
        goals = []
    cfg = _cfg_from(payload)
    stop_on_human = bool(payload.get("stop_on_human", True))
    result = await run_web_journey([str(g) for g in goals], config=cfg, stop_on_human=stop_on_human)
    return result.to_dict()


def _classify(goal: str) -> dict:
    """목표를 브라우저 없이 빠르게 분류(미리보기) — 발급/신청/미상 + 검증된 빠른경로 여부 + 폴백 링크.

    /run 이 오케스트레이션(무거움)이라면, 이건 '이 목표가 뭘 하려는지' 즉답(가벼움)이다.
    """
    g = (goal or "").strip()
    doc = default_resolver(g) if g else None
    kind = "unknown"
    if g:
        if any(w in g for w in _APPLY_WORDS) and not any(w in g for w in _ISSUE_WORDS):
            kind = "apply_welfare"
        elif doc or any(w in g for w in _ISSUE_WORDS):
            kind = "issue_doc"
    return {
        "goal": g,
        "kind": kind,                       # issue_doc | apply_welfare | unknown
        "resolved_doc": doc,                # 검증된 빠른경로로 인식된 서류(없으면 None)
        "deterministic": doc is not None,   # 결정적 빠른경로 대상인가
        "fallback_url": default_fallback_url(g),
    }


def _config_info() -> dict:
    """현재 가드레일 기본값 + 엔진 가용성(어떤 엔진이 실제로 준비됐는지 정직하게)."""
    cfg = WebAgentConfig.from_env()
    return {
        "config": {
            "engine": cfg.engine,
            "max_steps": cfg.max_steps,
            "timeout_s": cfg.timeout_s,
            "use_vision": cfg.use_vision,
        },
        "availability": {
            "browser_use": _browser_use_available(),  # 패키지+키 있으면 True
            "builtin_cdp": _cdp_reachable(),           # 내장(smart_agent) 붙을 크롬 떠 있나
            "llm_provider": select_provider() or "none",
        },
        "valid_engines": list(VALID_ENGINES),
    }


# ── FastAPI 라우터(핸들러를 얇게 감쌈) ──
router = APIRouter(prefix="/api/webagent", tags=["webagent"])


@router.post("/run")
async def run_endpoint(req: RunRequest) -> dict:
    return await _handle_run(req.model_dump())


@router.post("/journey")
async def journey_endpoint(req: JourneyRequest) -> dict:
    return await _handle_journey(req.model_dump())


@router.get("/config")
async def config_endpoint() -> dict:
    return _config_info()


@router.get("/classify")
async def classify_endpoint(goal: str) -> dict:
    return _classify(goal)
