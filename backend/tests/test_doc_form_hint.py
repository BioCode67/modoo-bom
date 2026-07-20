"""서류 발급 폼 '막힌 칸' 안내(_describe_unfilled_fields) — 읽기 전용 스캐너 계약 고정.

자동 입력만으로 다음 단계로 못 넘어갈 때, 사용자가 고쳐야 할 실제 폼 항목명(발급목적·귀속연도·세목 등)을
짚어 주기 위한 헬퍼다. 브라우저 없이 page.evaluate 반환만 스텁해
 (1) 라벨 조합·빈값 필터 (2) 예외가 나도 절대 발급 흐름을 깨지 않음(빈 문자열) 을 검증한다.
"""
import asyncio
from pathlib import Path

from rpa.gov24_rpa import _describe_unfilled_fields
import rpa.gov24_rpa as gov24


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


class _EvalPage:
    """page.evaluate 만 흉내내는 최소 페이지(스캐너는 읽기 전용이라 이거면 충분)."""

    def __init__(self, result=None, raise_exc=None):
        self._result = result
        self._raise = raise_exc

    async def evaluate(self, _script):
        if self._raise is not None:
            raise self._raise
        return self._result


def test_joins_scanned_field_labels():
    page = _EvalPage(result=["발급목적", "귀속연도"])
    assert _run(_describe_unfilled_fields(page)) == "발급목적, 귀속연도"


def test_filters_empty_labels():
    page = _EvalPage(result=["", "세목", None, "용도"])
    assert _run(_describe_unfilled_fields(page)) == "세목, 용도"


def test_empty_when_nothing_unfilled():
    assert _run(_describe_unfilled_fields(_EvalPage(result=[]))) == ""
    assert _run(_describe_unfilled_fields(_EvalPage(result=None))) == ""


def test_never_raises_into_flow():
    # 핵심 계약: 스캔이 실패(예외)해도 발급 루프를 절대 깨지 않고 빈 문자열을 돌려준다.
    page = _EvalPage(raise_exc=RuntimeError("evaluate boom"))
    assert _run(_describe_unfilled_fields(page)) == ""


def test_stuck_hint_uses_scanner_source_contract():
    # 소스 계약: 막힘(stuck) 안내가 스캐너를 호출해 '어느 칸'인지 구체적으로 짚는다.
    src = Path(gov24.__file__).read_text(encoding="utf-8")
    assert "_describe_unfilled_fields(page)" in src
    assert "항목을 선택/입력해 주세요" in src
