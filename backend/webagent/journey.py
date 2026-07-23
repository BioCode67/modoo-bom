# -*- coding: utf-8 -*-
"""웹 에이전트 여정 — 여러 목표(서류·신청)를 순서대로 이어서 수행하고 결과를 집계한다.

데스크탑의 '전부 자동발급'(orchestrator 여정)을 웹 에이전트 계층에서 재현한 것.
각 목표를 run_web_agent로 처리하고, 본인인증 같은 '사람 인계' 지점을 만나면(기본) 거기서 멈춰
사람이 인증을 마친 뒤 남은 목표로 이어가게 한다(정부 인증은 비가역·법적 안전장치라 대리 불가).

정직성: 실제 완료(done)만 done으로 집계하고, 라우팅(route)·사람확인(human)·실패(fallback/error)를
구분해 요약한다. 거짓 성공을 만들지 않는다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

from webagent.config import WebAgentConfig
from webagent.web_agent import DefaultExecutor, run_web_agent
from webagent.types import (
    STATUS_DONE,
    STATUS_ROUTE,
    STATUS_HUMAN_AUTH,
    STATUS_HUMAN_SUBMIT,
    STATUS_FALLBACK,
    STATUS_ERROR,
)


@dataclass
class WebJourneyResult:
    """여정 전체 결과(직렬화 가능)."""

    goals: list[str]
    steps: list[dict] = field(default_factory=list)  # 각 단계 WebAgentResult.to_dict()
    done_count: int = 0        # 실제 완료 확인
    routed_count: int = 0      # 검증된 빠른경로로 경로 확정(실행은 별도)
    human_count: int = 0       # 사람 인계(본인인증/최종제출)
    error_count: int = 0       # 실패/폴백
    stopped_at: Optional[int] = None  # 사람 인계로 멈춘 단계 인덱스(없으면 None)
    summary: str = ""

    def to_dict(self) -> dict:
        return {
            "goals": self.goals,
            "steps": self.steps,
            "done_count": self.done_count,
            "routed_count": self.routed_count,
            "human_count": self.human_count,
            "error_count": self.error_count,
            "stopped_at": self.stopped_at,
            "summary": self.summary,
        }


def _summarize(total: int, done: int, routed: int, human: int, error: int) -> str:
    if total == 0:
        return "이어서 처리할 목표가 없어요."
    parts = [f"목표 {total}개"]
    if done:
        parts.append(f"완료 {done}")
    if routed:
        parts.append(f"경로 확정 {routed}")
    if human:
        parts.append(f"본인확인 필요 {human}")
    if error:
        parts.append(f"자동 불가 {error}")
    return " · ".join(parts)


async def run_web_journey(
    goals: list[str],
    *,
    config: Optional[WebAgentConfig] = None,
    executor: Optional[DefaultExecutor] = None,
    resolver: Optional[Callable[[str], Optional[str]]] = None,
    stop_on_human: bool = True,
) -> WebJourneyResult:
    """목표 목록을 순서대로 이어서 수행한다.

    흐름:
      1) 각 목표를 run_web_agent로 처리(같은 config·executor 공유 → '한 번 인증' 연쇄를 재현).
      2) 상태별로 집계(done/route/human/error).
      3) stop_on_human 이면 첫 '사람 인계' 지점에서 멈추고 stopped_at을 기록
         (사람이 인증을 마친 뒤 남은 목표로 다시 호출 — 정부 인증은 대리 불가).
      4) 사람이 읽을 요약을 만들어 반환.
    """
    cfg = config or WebAgentConfig.from_env()
    ex = executor or DefaultExecutor()
    gs = [g for g in (goals or []) if (g or "").strip()]

    steps: list[dict] = []
    done = routed = human = error = 0
    stopped_at: Optional[int] = None

    for i, goal in enumerate(gs):
        r = await run_web_agent(goal, config=cfg, executor=ex, resolver=resolver)
        steps.append(r.to_dict())
        if r.status == STATUS_DONE:
            done += 1
        elif r.status == STATUS_ROUTE:
            routed += 1
        elif r.status in (STATUS_HUMAN_AUTH, STATUS_HUMAN_SUBMIT):
            human += 1
        elif r.status in (STATUS_FALLBACK, STATUS_ERROR):
            error += 1

        if stop_on_human and r.needs_human:
            stopped_at = i
            break

    return WebJourneyResult(
        goals=gs,
        steps=steps,
        done_count=done,
        routed_count=routed,
        human_count=human,
        error_count=error,
        stopped_at=stopped_at,
        summary=_summarize(len(gs), done, routed, human, error),
    )
