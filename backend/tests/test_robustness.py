# -*- coding: utf-8 -*-
"""견고성 회귀 테스트 — 다중에이전트 감사(2026-07)에서 확정된 백엔드 결함 고정.

각 테스트는 '고치기 전이면 실패'하도록 실제 결함 경로를 재현한다."""
import asyncio
import json

import pytest


# ── #1 extract_json: 최상위가 객체가 아니면 ValueError(호출부 규칙폴백 유도) ──
class TestExtractJsonAlwaysDict:
    def test_fenced_array_raises(self):
        # LLM이 ```json 으로 배열을 감싸 반환 → 예전엔 list 반환 → 노드의 result.get()이
        # except 밖에서 AttributeError로 분석을 죽였다. 이제 ValueError로 폴백을 탄다.
        from agents.utils import extract_json
        with pytest.raises(ValueError):
            extract_json('```json\n[{"id": 1}]\n```')

    def test_braceless_array_raises(self):
        from agents.utils import extract_json
        with pytest.raises(ValueError):
            extract_json('["a", "b"]')

    def test_toplevel_scalar_raises(self):
        from agents.utils import extract_json
        for bad in ("42", '"hi"', "true", "null"):
            with pytest.raises(ValueError):
                extract_json(bad)

    def test_valid_object_paths_still_work(self):
        from agents.utils import extract_json
        assert extract_json('{"eligible_policies": []}') == {"eligible_policies": []}
        assert extract_json('```json\n{"x": 1}\n```') == {"x": 1}
        # 앞뒤 설명 텍스트가 붙어도 첫 객체 추출
        assert extract_json("결과: {\"a\": 1} 입니다") == {"a": 1}

    def test_all_llm_nodes_use_get_after_extract(self):
        # 4개 LLM 노드가 result.get()으로 접근하는지(직접 인덱싱 아님) 소스로 고정 —
        # extract_json이 dict를 보장하므로 안전하지만, 회귀로 패턴을 지킨다.
        import pathlib
        base = pathlib.Path(__file__).resolve().parents[1] / "agents" / "nodes"
        for fn in ("eligibility_check.py", "guide_generator.py",
                   "profile_analyzer.py", "reflection_check.py"):
            src = (base / fn).read_text(encoding="utf-8")
            assert "result.get(" in src, f"{fn}: result.get 미사용"


# ── #6 catalog_loader._parse: 비컨테이너 JSON → [] (AttributeError 방지) ──
class TestCatalogParse:
    def test_non_container_returns_empty(self):
        from rag.catalog_loader import _parse
        assert _parse(3) == []
        assert _parse("x") == []
        assert _parse(None) == []

    def test_list_and_dict(self):
        from rag.catalog_loader import _parse
        assert _parse([{"id": 1}]) == [{"id": 1}]
        assert _parse({"policies": [{"id": 2}]}) == [{"id": 2}]
        assert _parse({"no_policies_key": 1}) == []


# ── #5 chat._related_policies: 키 없는 검색결과에도 KeyError 없이 안전 ──
class TestRelatedPolicies:
    def test_missing_keys_do_not_raise(self):
        from api.chat import _related_policies
        # BM25 결과가 category/name 없이 와도 answer를 버리지 않는다.
        out = _related_policies([{"id": "X"}, {}, {"name": "기초연금"}])
        assert out == [
            {"id": "X", "name": None, "category": None},
            {"id": None, "name": None, "category": None},
            {"id": None, "name": "기초연금", "category": None},
        ]

    def test_caps_at_k_and_handles_empty(self):
        from api.chat import _related_policies
        assert _related_policies([]) == []
        assert _related_policies(None) == []
        assert len(_related_policies([{"id": i} for i in range(10)])) == 3


# ── ETL _pick(공백무시 퍼지)/_ypick(정확) 섀도잉 해소 ──
class TestEtlPickShadowing:
    def test_csv_pick_is_space_tolerant(self):
        from etl.ingest_welfare import _pick
        row = {"서비스 명": "기초연금", "시 도 명": "서울"}
        assert _pick(row, "서비스명") == "기초연금"
        assert _pick(row, "시도명") == "서울"
        assert _pick(row, "없는키") == ""

    def test_youth_ypick_is_exact_and_skips_blanks(self):
        from etl.ingest_welfare import _ypick
        it = {"plcyNm": "청년월세", "x": "null", "y": "-", "z": "  값 "}
        assert _ypick(it, "plcyNm") == "청년월세"
        assert _ypick(it, "x", "plcyNm") == "청년월세"   # 'null' 스킵
        assert _ypick(it, "y", "plcyNm") == "청년월세"   # '-' 스킵
        assert _ypick(it, "z") == "값"                    # 트림
        assert _ypick(it, "없는키") == ""

    def test_two_functions_are_distinct(self):
        # 동일 이름이면 나중 정의가 CSV용을 섀도잉 → 두 함수가 별개여야 한다.
        from etl.ingest_welfare import _pick, _ypick
        assert _pick is not _ypick


# ── #2 _spawn_bg: 백그라운드 태스크 강한 참조 보관 + 완료 시 자동 정리 ──
@pytest.mark.asyncio
async def test_spawn_bg_anchors_then_discards():
    from rpa.manager import _spawn_bg, _bg_tasks

    async def _work():
        await asyncio.sleep(0)
        return "done"

    t = _spawn_bg(_work())
    assert t in _bg_tasks           # 실행 중엔 강한 참조 보유
    result = await t
    await asyncio.sleep(0)          # done 콜백 처리 기회
    assert t not in _bg_tasks       # 완료 후 자동 제거
    assert result == "done"
