"""프론트 복지 엔진(welfare-engine.ts) ↔ 백엔드 Mock(mock_responses.py) '데이터 파리티' 고정.

두 파일은 **의도적 포팅본**이다(프론트는 백엔드 없이도 전 기능 동작해야 하므로).
문제는 손으로 유지된다는 것 — 실제로 다음 드리프트가 발생했었다:

  · 아동수당 desc 가 프론트만 '만 9세 미만'(2026 확대)으로 고쳐지고 백엔드는 '8세'로 남음.
    게다가 mock_guides 는 `tmpl.get("desc") or full.get("benefit")` 이라 **낡은 템플릿이
    고쳐진 카탈로그를 이긴다** → 키 없을 때 기본인 Mock 모드에서 틀린 자격을 안내.
  · 가이드 템플릿이 프론트 7종 / 백엔드 3종으로 갈라져, 같은 정책인데 백엔드 쪽만
    "주민센터 방문하세요" 일반 문구로 떨어짐.
  · 백엔드는 exact match 라 '실업급여 (구직급여)' 가 '실업급여' 템플릿과 안 맞아 dead.
    프론트는 접두 매칭으로 이미 고쳤지만 백엔드엔 반영 안 됨.

TS 를 파싱해 비교하므로 '같은 사실'이 양쪽에 있는지 기계적으로 강제된다.
"""
import json
import re
from pathlib import Path

import pytest

from agents.mock_responses import _GUIDE_TEMPLATES, _lookup_guide_template

_ENGINE_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "welfare-engine.ts"

pytestmark = pytest.mark.skipif(
    not _ENGINE_TS.exists(),
    reason="프론트 소스 없음(백엔드만 배포된 컨테이너) — 파리티는 개발·CI 에서 검증",
)


def _parse_ts_guide_templates() -> dict:
    """welfare-engine.ts 의 GUIDE_TEMPLATES 를 파싱.

    전체 TS 파서가 아니라 이 리터럴 한 덩어리만 읽는다 — 형태가 바뀌면 테스트가
    '조용히 통과'하지 않고 실패하도록, 파싱 실패는 예외로 터뜨린다."""
    src = _ENGINE_TS.read_text(encoding="utf-8")
    m = re.search(r"GUIDE_TEMPLATES[^=]*=\s*\{", src)
    if not m:
        raise AssertionError("welfare-engine.ts 에서 GUIDE_TEMPLATES 를 찾지 못함(구조 변경?)")

    # 중괄호 균형으로 리터럴 끝을 찾는다(문자열 안의 괄호는 건너뜀).
    start = m.end() - 1
    depth, i, in_str, quote = 0, start, False, ""
    while i < len(src):
        ch = src[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                in_str = False
        elif ch in "'\"`":
            in_str, quote = True, ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    else:
        raise AssertionError("GUIDE_TEMPLATES 리터럴의 끝을 찾지 못함")

    body = src[start : i + 1]

    templates: dict = {}
    # 각 최상위 키의 desc / days 만 추출(steps·tips 는 문장 단위라 비교 대상에서 제외).
    for km in re.finditer(r"(?:^|\n)  (?:'([^']+)'|\"([^\"]+)\"|([^\s:'\"]+))\s*:\s*\{", body):
        key = km.group(1) or km.group(2) or km.group(3)
        chunk = body[km.end() :]
        chunk = chunk[: chunk.find("\n  },")] if "\n  },"  in chunk else chunk
        dm = re.search(r"desc:\s*(['\"])(.*?)\1", chunk, re.S)
        ym = re.search(r"days:\s*(\d+)", chunk)
        if not dm or not ym:
            raise AssertionError(f"'{key}' 템플릿에서 desc/days 파싱 실패")
        templates[key] = {"desc": dm.group(2), "days": int(ym.group(1))}
    if not templates:
        raise AssertionError("GUIDE_TEMPLATES 파싱 결과가 비었음")
    return templates


def test_guide_template_keys_match():
    """양쪽 템플릿 '집합'이 동일 — 한쪽만 정책을 추가/삭제하는 드리프트 차단."""
    ts = set(_parse_ts_guide_templates())
    py = set(_GUIDE_TEMPLATES)
    assert py == ts, (
        f"가이드 템플릿 드리프트\n"
        f"  백엔드에만 있음: {sorted(py - ts)}\n"
        f"  프론트에만 있음: {sorted(ts - py)}"
    )


def test_guide_template_facts_match():
    """desc(자격·금액 같은 '사실')와 처리일수가 동일 — 아동수당 8세/9세 류의 사실 드리프트 차단."""
    ts = _parse_ts_guide_templates()
    mismatched = {
        k: {"frontend": ts[k]["desc"], "backend": _GUIDE_TEMPLATES[k]["desc"]}
        for k in ts
        if k in _GUIDE_TEMPLATES and ts[k]["desc"] != _GUIDE_TEMPLATES[k]["desc"]
    }
    assert not mismatched, "desc 사실 불일치:\n" + json.dumps(mismatched, ensure_ascii=False, indent=2)

    days = {
        k: {"frontend": ts[k]["days"], "backend": _GUIDE_TEMPLATES[k]["days"]}
        for k in ts
        if k in _GUIDE_TEMPLATES and ts[k]["days"] != _GUIDE_TEMPLATES[k]["days"]
    }
    assert not days, f"estimated_days 불일치: {days}"


def test_no_dead_templates_for_catalog_names():
    """카탈로그 실제 정책명이 템플릿에 도달하는지 — 접두 매칭 회귀 고정.

    '실업급여 (구직급여)'·'주거급여 (기초생활보장)' 처럼 카탈로그 이름에 괄호 수식이 붙어
    exact match 로는 템플릿이 dead 였던 문제(프론트는 이미 접두 매칭으로 해결)."""
    from rag.sample_data import WELFARE_POLICIES

    names = {p.get("name", "") for p in WELFARE_POLICIES}
    for key in _GUIDE_TEMPLATES:
        reachable = [n for n in names if n == key or n.startswith(key)]
        assert reachable, f"'{key}' 템플릿에 도달하는 카탈로그 정책이 없음(dead template)"
        # 그 이름으로 실제 조회했을 때도 같은 템플릿이 나와야 한다.
        for n in reachable:
            assert _lookup_guide_template(n), f"'{n}' → 템플릿 조회 실패"


def test_income_thresholds_match():
    """2026 선정기준(생계32·의료40·주거48·교육/차상위50)이 양쪽에 동일하게 존재."""
    ts_src = _ENGINE_TS.read_text(encoding="utf-8")
    import agents.mock_responses as mr
    import inspect

    py_src = inspect.getsource(mr)
    for pct in (32, 40, 48, 50):
        assert str(pct) in ts_src, f"프론트에 중위소득 {pct}% 기준 없음"
        assert str(pct) in py_src, f"백엔드에 중위소득 {pct}% 기준 없음"
