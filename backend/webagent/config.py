# -*- coding: utf-8 -*-
"""웹 에이전트 설정 — 환경변수로 안전 가드레일을 조정한다.

핵심 가드레일(무한 루프·비용 폭주·멈춤 방지):
  - max_steps : 관찰-판단-실행 루프의 최대 반복(기본 15). LLM 이 같은 화면을 맴돌아도 여기서 끊긴다.
  - timeout_s : 전체 실행 상한(초). 사이트가 응답을 멈춰도 무한 대기하지 않는다.

engine 우선순위:
  auto          → 결정적 빠른경로 우선, 실패/미지원이면 LLM 에이전트, 그래도 안 되면 공식 링크 폴백
  deterministic → 검증된 빠른경로만(아는 서류) — 실패 시 폴백
  browser_use   → browser-use 프레임워크 엔진 강제(설치+키 필요)
  builtin       → 내장 관찰-판단-실행 루프 강제
"""
from __future__ import annotations

import os
from dataclasses import dataclass

VALID_ENGINES = ("auto", "deterministic", "browser_use", "builtin")


def _int_env(name: str, default: int) -> int:
    try:
        v = int(str(os.getenv(name, "")).strip())
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default


def _float_env(name: str, default: float) -> float:
    try:
        v = float(str(os.getenv(name, "")).strip())
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default


def _bool_env(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class WebAgentConfig:
    """에이전트 실행 파라미터(환경변수 기본값 + 코드 오버라이드)."""

    max_steps: int = 15            # 루프 반복 상한(무한 루프 안전장치)
    timeout_s: float = 180.0       # 전체 타임아웃(초)
    engine: str = "auto"           # auto|deterministic|browser_use|builtin
    use_vision: bool = True        # 스크린샷을 판단에 사용(비전 모델일 때)
    headless: bool = False         # 정부 사이트는 headed 권장(간편인증 UX)
    model: str | None = None       # 강제 모델(미지정 시 provider 기본값)

    @classmethod
    def from_env(cls) -> "WebAgentConfig":
        engine = (os.getenv("WEBAGENT_ENGINE", "auto") or "auto").strip().lower()
        if engine not in VALID_ENGINES:
            engine = "auto"
        return cls(
            max_steps=_int_env("WEBAGENT_MAX_STEPS", 15),
            timeout_s=_float_env("WEBAGENT_TIMEOUT", 180.0),
            engine=engine,
            use_vision=_bool_env("WEBAGENT_VISION", True),
            headless=_bool_env("WEBAGENT_HEADLESS", False),
            model=(os.getenv("WEBAGENT_MODEL", "").strip() or None),
        )
