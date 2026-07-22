# -*- coding: utf-8 -*-
"""AI 웹 에이전트의 구조화 결과(JSON 계약).

에이전트가 무엇을 어떻게 했는지를 '한 개의 구조화 객체'로 돌려준다. 호출부(로컬 서버·데스크탑 앱·
프론트)는 이 계약만 알면 되고, 내부가 browser-use 든 내장 루프든 결정적 빠른경로든 신경 쓰지 않는다.

정직성 규칙(프로젝트 전반과 동일): `success=True` 는 '실제로 완료를 확인'했을 때만.
발급/신청을 실행하지 않고 경로만 잡았거나, 사람 인증·제출로 넘긴 경우는 success=False + 명시적 status.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict


# 결과 상태 — UI 가 '완료 배지'를 띄워도 되는지 구분하는 단일 기준.
#   done            : 실제 완료 확인됨(success=True 인 유일한 정상 종료)
#   needs_human_auth: 본인인증(카카오 간편인증 등)을 사람에게 넘김(비가역·법적 안전장치)
#   needs_human_submit: 최종 제출을 사람에게 넘김(문서 작성까지만 자동)
#   route           : 실행하지 않고 '이 목표는 이 경로로 처리 가능'만 판정(계획)
#   fallback        : 자동 처리 불가 → 공식 링크로 정직하게 안내
#   error           : 예외/타임아웃으로 실패(공식 링크 폴백 동봉)
STATUS_DONE = "done"
STATUS_HUMAN_AUTH = "needs_human_auth"
STATUS_HUMAN_SUBMIT = "needs_human_submit"
STATUS_ROUTE = "route"
STATUS_FALLBACK = "fallback"
STATUS_ERROR = "error"


@dataclass
class WebAgentResult:
    """웹 에이전트 실행 결과(직렬화 가능)."""

    goal: str                       # 자연어 목표(예: "주민등록등본 발급")
    success: bool                   # 실제 완료를 확인했는가(오직 STATUS_DONE 일 때만 True)
    status: str                     # 위 STATUS_* 중 하나
    engine: str                     # 처리 엔진: deterministic|browser_use|builtin|none
    steps: int = 0                  # 에이전트가 수행한 반복 수(가드레일 대비 관측용)
    extracted: dict = field(default_factory=dict)  # 구조화 추출 데이터(발급 서류·저장 경로·조회값 등)
    message: str = ""               # 사람이 읽을 한 줄 안내(PII 미포함)
    fallback_url: str | None = None  # 자동 실패 시 안내할 공식 경로
    needs_human: str | None = None  # 'auth' | 'submit' | None — 사람이 이어받아야 하는 지점
    error: str | None = None        # 실패 사유(디버그용, PII 미포함)

    def to_dict(self) -> dict:
        """JSON 직렬화용 dict. None 값도 그대로 담아 계약을 고정한다."""
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)

    # ── 자주 쓰는 결과를 만드는 생성자들(호출부 실수 방지·계약 일관) ──
    @classmethod
    def fallback_result(cls, goal: str, url: str | None, message: str, error: str | None = None) -> "WebAgentResult":
        return cls(goal=goal, success=False, status=STATUS_FALLBACK, engine="none",
                   message=message, fallback_url=url, error=error)

    @classmethod
    def error_result(cls, goal: str, message: str, error: str, url: str | None = None) -> "WebAgentResult":
        return cls(goal=goal, success=False, status=STATUS_ERROR, engine="none",
                   message=message, fallback_url=url, error=error)
