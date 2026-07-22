# -*- coding: utf-8 -*-
"""AI 웹 에이전트 — 자연어 목표를 받아 정부/공공 사이트 자동화를 수행하고 구조화 결과를 돌려준다.

설계 철학(기존 하드코딩 매크로를 '스마트 에이전트'로):
  ┌ 빠른 경로(결정적)   : '아는 서류·아는 흐름'은 실측 검증된 경로로 확실하게(local_agent). 화면을 헤매지 않는다.
  ├ 에이전트 경로(LLM)  : '처음 보는 서류·동적/복잡/예외'는 browser-use 에이전트가 화면을 읽고 스스로 풀어간다.
  └ 정직한 폴백        : 자동 실행이 불가하면(키 없음·미설치·환경 제약) 공식 링크로 안내(거짓 성공 금지).

이 모듈은 '오케스트레이션 계층'이다 — 실제 브라우저 구동은 아래에 위임한다:
  · 결정적 경로  → 기존 하드닝된 local_agent / rpa 흐름(재구현하지 않음, '경로만' 판정)
  · 에이전트     → browser-use(설치+키 시) 또는 호출부가 주입한 내장 러너(smart_agent 등)

가드레일(무한 루프·비용·멈춤 방지):
  · max_steps(기본 15) — 에이전트 반복 상한
  · timeout(기본 180s) — 전체 실행 상한(asyncio.wait_for)
  · try/except 롤백    — 한 엔진이 실패하면 다음 엔진으로, 그래도 안 되면 공식 링크 폴백

본인인증·최종 제출은 언제나 사람이 직접(비가역·법적 안전장치). 개인정보는 서버에 저장/로깅하지 않는다.
"""
from __future__ import annotations

import asyncio
import inspect
import socket
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional
from urllib.parse import urlparse

from webagent.config import WebAgentConfig
from webagent.types import (
    WebAgentResult,
    STATUS_DONE,
    STATUS_ROUTE,
    STATUS_HUMAN_AUTH,
    STATUS_HUMAN_SUBMIT,
)


@dataclass
class EngineOutcome:
    """한 엔진의 실행 결과(오케스트레이터가 WebAgentResult 로 승격)."""

    handled: bool                 # 이 엔진이 목표를 맡았는가(False면 다음 엔진으로)
    success: bool = False
    status: str = STATUS_ROUTE
    engine: str = "none"
    steps: int = 0
    extracted: dict = field(default_factory=dict)
    message: str = ""
    needs_human: Optional[str] = None
    error: Optional[str] = None


# 목표 성격 분류용 키워드(폴백 링크·라우팅 힌트)
_ISSUE_WORDS = ("발급", "떼", "출력", "증명서", "등본", "초본", "확인서", "내역서")
_APPLY_WORDS = ("신청", "접수", "지원금", "수당", "급여", "바우처")


def default_fallback_url(goal: str) -> str:
    """자동 실행이 안 될 때 안내할 공식 경로(목표 성격으로 정부24/복지로 선택)."""
    g = goal or ""
    if any(w in g for w in _APPLY_WORDS) and not any(w in g for w in _ISSUE_WORDS):
        return "https://www.bokjiro.go.kr"   # 복지 신청은 복지로
    return "https://www.gov.kr"              # 서류 발급은 정부24


# ── 결정적 빠른경로: 목표 → 검증된 서류 키(있으면) ────────────────────────────
def default_resolver(goal: str) -> Optional[str]:
    """local_agent.resolve_doc 를 안전하게 감싼다(백엔드 밖·미설치면 None).

    resolve_doc 은 '모호하면 None'(엉뚱한 서류 대리발급 방지)이라 그대로 계약을 존중한다.
    """
    try:
        from local_agent import resolve_doc
    except Exception:  # noqa: BLE001 — local_agent 미가용 환경
        return None
    try:
        return resolve_doc(goal)
    except Exception:  # noqa: BLE001
        return None


def _cdp_reachable(timeout: float = 0.3) -> bool:
    """내장(smart_agent) 경로가 붙는 진짜 크롬(CDP)이 떠 있는지 짧게 확인.

    개발/CI 환경엔 CDP 크롬이 없으므로 False → 내장 엔진은 '준비 안 됨'으로 정직하게 축소된다.
    """
    try:
        from local_agent import CDP_URL
    except Exception:  # noqa: BLE001
        return False
    try:
        u = urlparse(CDP_URL)
        host, port = u.hostname or "127.0.0.1", u.port or 9222
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:  # noqa: BLE001
        return False


# ── browser-use 어댑터(지연 임포트) ─────────────────────────────────────────
def _browser_use_available() -> bool:
    """browser-use 패키지 + 판단용 LLM 키가 모두 있어야 준비됨."""
    try:
        import browser_use  # noqa: F401
    except Exception:  # noqa: BLE001 — 미설치(기본)
        return False
    from webagent.llm_factory import select_provider
    return select_provider() is not None


def _extract_browser_use_result(history) -> tuple[bool, str, dict, int]:
    """browser-use 실행 히스토리에서 (완료여부, 최종 텍스트, 추출데이터, 스텝수)를 방어적으로 뽑는다.

    browser-use 버전마다 히스토리 API가 조금씩 다르므로(final_result/extracted_content/is_done 등)
    있는 메서드만 사용한다. 실측 검증은 데스크탑의 고정 버전에서, 여기선 크래시만 막는다.
    """
    done, text, steps = False, "", 0
    for attr in ("is_done", "is_successful"):
        fn = getattr(history, attr, None)
        try:
            if callable(fn) and fn():
                done = True
                break
        except Exception:  # noqa: BLE001
            pass
    for attr in ("final_result", "final_answer"):
        fn = getattr(history, attr, None)
        try:
            if callable(fn):
                r = fn()
                if r:
                    text = str(r)
                    break
        except Exception:  # noqa: BLE001
            pass
    for attr in ("number_of_steps", "n_steps"):
        fn = getattr(history, attr, None)
        try:
            steps = int(fn()) if callable(fn) else int(fn)
            break
        except Exception:  # noqa: BLE001
            pass
    extracted = {"final": text} if text else {}
    return done, text, extracted, steps


async def _run_browser_use(goal: str, cfg: WebAgentConfig) -> EngineOutcome:
    """browser-use Agent 로 목표를 수행. (지연 임포트 · 버전 관용 · 실패 시 예외 → 롤백)"""
    from browser_use import Agent  # 지연 임포트(미설치면 여기서 ImportError → 롤백)
    from webagent.llm_factory import build_agent_llm

    llm = build_agent_llm(cfg.model, prefer_vision=cfg.use_vision)
    if llm is None:
        raise RuntimeError("browser-use 판단용 LLM 키가 없습니다(GEMINI_API_KEY 등).")

    # 버전에 따라 지원 kwargs 가 달라 최소 인자로 생성 후 옵션은 있으면만 반영.
    try:
        agent = Agent(task=goal, llm=llm, use_vision=cfg.use_vision)
    except TypeError:
        agent = Agent(task=goal, llm=llm)

    history = await agent.run(max_steps=cfg.max_steps)
    done, text, extracted, steps = _extract_browser_use_result(history)
    return EngineOutcome(
        handled=True,
        success=bool(done),
        status=STATUS_DONE if done else STATUS_HUMAN_SUBMIT,
        engine="browser_use",
        steps=steps,
        extracted=extracted,
        message=(text[:200] if text else ("완료" if done else "여기까지 진행 — 최종 확인/제출은 직접")),
        needs_human=None if done else "submit",
    )


# 호출부가 내장 러너(smart_agent 등)를 주입하는 시그니처
BuiltinRunner = Callable[[str, WebAgentConfig], Awaitable[EngineOutcome]]


class DefaultExecutor:
    """기본 실행기 — 에이전트 경로를 browser-use 로 구동한다.

    · browser_use_runner : 기본은 내장 _run_browser_use(지연 임포트). 테스트/커스텀은 주입 가능.
    · builtin_runner     : 데스크탑이 smart_agent 등을 붙일 자리(기본 None → 준비 안 됨).
    두 러너 모두 없거나 준비 안 되면 handled=False 를 돌려 오케스트레이터가 정직한 폴백을 내게 한다.
    """

    def __init__(
        self,
        browser_use_runner: Optional[BuiltinRunner] = None,
        builtin_runner: Optional[BuiltinRunner] = None,
    ):
        self._bu = browser_use_runner or _run_browser_use
        self._builtin = builtin_runner

    def _order(self, engine: str) -> list[str]:
        if engine == "browser_use":
            return ["browser_use"]
        if engine == "builtin":
            return ["builtin"]
        return ["browser_use", "builtin"]  # auto: 프레임워크 우선, 내장으로 롤백

    def _ready(self, name: str) -> bool:
        if name == "browser_use":
            # 커스텀 러너를 주입했으면 그걸 신뢰, 아니면 패키지+키 확인
            return self._bu is not _run_browser_use or _browser_use_available()
        if name == "builtin":
            return self._builtin is not None and _cdp_reachable()
        return False

    async def run_agent(self, goal: str, cfg: WebAgentConfig) -> EngineOutcome:
        """에이전트 엔진들을 우선순위로 시도(한 엔진 실패 → 다음으로 롤백)."""
        last: Optional[Exception] = None
        for name in self._order(cfg.engine):
            if not self._ready(name):
                continue
            runner = self._bu if name == "browser_use" else self._builtin
            try:
                return await runner(goal, cfg)  # type: ignore[misc]
            except Exception as e:  # noqa: BLE001 — 이 엔진 실패 → 다음 엔진
                last = e
                continue
        return EngineOutcome(
            handled=False, engine="none",
            message="자동 실행 엔진이 준비되지 않았습니다(browser-use 미설치/키 없음).",
            error=(str(last)[:200] if last else None),
        )


async def _maybe_await(v):
    """동기/비동기 리졸버 모두 허용."""
    if inspect.isawaitable(v):
        return await v
    return v


async def run_web_agent(
    goal: str,
    *,
    config: Optional[WebAgentConfig] = None,
    executor: Optional[DefaultExecutor] = None,
    resolver: Optional[Callable[[str], Optional[str]]] = None,
    fallback_url: Optional[str] = None,
) -> WebAgentResult:
    """자연어 목표를 하이브리드 파이프라인으로 처리하고 구조화 결과(WebAgentResult)를 반환한다.

    흐름:
      1) 입력 검증(빈 목표는 error)
      2) 결정적 빠른경로 — 목표가 '아는 서류'로 해석되면 검증된 경로로 라우팅(status=route)
         (실행은 기존 하드닝된 흐름의 몫 — 여기서 재구현/대리발급하지 않는다)
      3) 에이전트 경로 — 그 외/복잡/예외는 browser-use 에이전트가 수행(timeout·max_steps 가드)
      4) 정직한 폴백 — 아무 엔진도 못 맡으면 공식 링크로 안내(거짓 성공 금지)
    """
    cfg = config or WebAgentConfig.from_env()
    g = (goal or "").strip()
    fb = fallback_url or default_fallback_url(g)

    if not g:
        return WebAgentResult.error_result(
            goal=goal or "", message="목표(원하는 서류·신청)를 한 문장으로 알려주세요.",
            error="empty goal", url=fb,
        )

    # ── 2) 결정적 빠른경로(아는 서류) ──
    if cfg.engine in ("auto", "deterministic"):
        resolve = resolver or default_resolver
        try:
            canonical = await _maybe_await(resolve(g))
        except Exception:  # noqa: BLE001
            canonical = None
        if canonical:
            return WebAgentResult(
                goal=g, success=False, status=STATUS_ROUTE, engine="deterministic",
                extracted={"resolved_doc": canonical, "path": "deterministic"},
                message=f"'{canonical}'은 검증된 빠른 경로로 발급합니다(더 안정적).",
                fallback_url=fb,
            )
        if cfg.engine == "deterministic":
            # 결정적 강제인데 못 알아봄 → 에이전트로 승격하지 않고 정직 폴백
            return WebAgentResult.fallback_result(
                goal=g, url=fb,
                message="검증된 빠른 경로로는 인식하지 못했어요. 공식 사이트에서 확인해 주세요.",
            )

    # ── 3) 에이전트 경로(browser-use) — 타임아웃·max_steps 가드레일 + 예외 롤백 ──
    ex = executor or DefaultExecutor()
    try:
        outcome = await asyncio.wait_for(ex.run_agent(g, cfg), timeout=cfg.timeout_s)
    except asyncio.TimeoutError:
        return WebAgentResult.error_result(
            goal=g, message=f"시간 제한({int(cfg.timeout_s)}초)을 넘겨 멈췄어요. 공식 사이트로 이어가 주세요.",
            error="timeout", url=fb,
        )
    except Exception as e:  # noqa: BLE001 — 예상 못한 실패도 앱을 죽이지 않고 폴백
        return WebAgentResult.error_result(
            goal=g, message="자동 처리 중 문제가 생겼어요. 공식 사이트로 안내할게요.",
            error=str(e)[:200], url=fb,
        )

    if outcome.handled:
        status = outcome.status
        # 사람 인계 지점을 명시적 status 로 승격(UI 가 '완료'로 오인하지 않게)
        if outcome.needs_human == "auth":
            status = STATUS_HUMAN_AUTH
        elif outcome.needs_human == "submit" and status != STATUS_DONE:
            status = STATUS_HUMAN_SUBMIT
        return WebAgentResult(
            goal=g, success=bool(outcome.success), status=status, engine=outcome.engine,
            steps=outcome.steps, extracted=outcome.extracted, message=outcome.message,
            fallback_url=fb, needs_human=outcome.needs_human, error=outcome.error,
        )

    # ── 4) 정직한 폴백 ──
    return WebAgentResult.fallback_result(
        goal=g, url=fb,
        message="이 환경에선 자동 실행이 어려워요. 공식 사이트에서 바로 진행할 수 있게 안내할게요.",
        error=outcome.error,
    )
