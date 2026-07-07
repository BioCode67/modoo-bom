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


# ═══ 2차 감사(미감사 영역) 회귀 ═══════════════════════════════════════════════

# ── #1(2차) 임신 프로필: recommended_policies는 dict가 아닌 list여야(하위 [:2] TypeError 방지) ──
async def _preg_notifs():
    from agents.nodes.notification_agent import notification_agent_node
    from agents.state import AgentState, UserProfile
    profile = UserProfile(name="김수정", age=32, gender="female",
                          is_pregnant=True, life_events=[])  # 생애이벤트 없음 → 임신알림이 [0]
    out = await notification_agent_node(AgentState(user_profile=profile, query="임신 출산 지원"))
    return out["notifications"]


@pytest.mark.asyncio
async def test_pregnancy_recommended_policies_is_list():
    notifs = await _preg_notifs()
    preg = [n for n in notifs if n.get("type") == "pregnancy"]
    assert preg, "임신 알림이 생성되지 않음"
    rp = preg[0]["recommended_policies"]
    assert isinstance(rp, list), f"list여야 하는데 {type(rp).__name__}"
    assert all(isinstance(x, str) for x in rp)


@pytest.mark.asyncio
async def test_pregnancy_mock_final_response_no_typeerror():
    # 예전엔 dict[:2]에서 TypeError로 임신 프로필 분석이 크래시했다.
    # 시그니처: mock_final_response(eligible, docs, notifications)
    from agents.mock_responses import mock_final_response
    notifs = await _preg_notifs()
    resp = mock_final_response([], [], notifs)  # 크래시 없이 문자열 반환
    assert isinstance(resp, str) and resp


@pytest.mark.asyncio
async def test_full_graph_pregnant_no_crash():
    # 임신+생애이벤트 없음(임신알림이 notifications[0]) 프로필로 전체 그래프가 크래시 없이 완주.
    from agents.graph import build_graph
    from agents.state import AgentState, UserProfile
    graph = build_graph()
    profile = UserProfile(name="김수정", age=32, gender="female", region="서울특별시",
                          household_type="신혼부부", income_percentile=45,
                          is_pregnant=True, life_events=[])
    final_state = await graph.ainvoke(AgentState(user_profile=profile, query="임신 출산 지원").model_dump())
    assert final_state is not None
    assert final_state.get("final_response", "") != ""


# ── #4 nhis _normalize: None 값 str 강제(TypeError 방지) ──
def test_nhis_normalize_none_safe():
    from rpa.nhis_rpa import _normalize
    assert _normalize({"user_name": None, "birth_date": None, "phone": None}) == ("", "", "010", "")
    assert _normalize({"user_name": "홍길동", "birth_date": "90-01-02", "phone": "010-1234-5678"}) \
        == ("홍길동", "900102", "010", "12345678")


# ── #5 portfolio _estimate: 콤마만 매칭 시 int("") ValueError 방지 ──
def test_portfolio_estimate_comma_only():
    from agents.nodes.portfolio_manager import _estimate_monthly_benefit
    assert _estimate_monthly_benefit("x", "월 ,원") == 0
    assert _estimate_monthly_benefit("기초연금", "월 30만원") == 300000


# ── #2 rate_limit: 상한 초과 시 만료 버킷 청소(무한증가 방지) ──
def test_rate_limit_evicts_expired():
    import api.rate_limit as rl
    saved_max = rl._MAX_BUCKETS
    try:
        rl._buckets.clear()
        rl._MAX_BUCKETS = 10
        now = 100000.0
        for i in range(12):
            rl._buckets[f"k{i}"] = [1, now - 200]  # 모두 만료
        rl._maybe_evict(now)
        assert len(rl._buckets) == 0
    finally:
        rl._MAX_BUCKETS = saved_max
        rl._buckets.clear()


# ── #3 gov24 _doc_store: 상한 초과 시 오래된 항목 제거 ──
@pytest.mark.asyncio
async def test_gov24_doc_store_bounded():
    import mocks.gov24_api as g
    saved_max = g._MAX_DOCS
    try:
        g._doc_store.clear()
        g._MAX_DOCS = 5
        for i in range(8):
            await g.issue_document("주민등록등본", f"사용자{i}")
        assert len(g._doc_store) <= 5
    finally:
        g._MAX_DOCS = saved_max
        g._doc_store.clear()


# ── chat _dedup_by_name: 시드+공공데이터 동일제도 중복 제거(챗 답변 정리) ──
def test_chat_dedup_by_name():
    from api.chat import _dedup_by_name
    out = _dedup_by_name([
        {"name": "청년 월세 한시 특별지원", "category": "청년"},
        {"name": "청년월세 한시특별지원", "category": "청년주거"},  # 공백만 다름 → 중복
        {"name": "기초연금"},
        {"name": ""},          # 빈 이름 제외
        {"category": "x"},     # 이름 없음 제외
    ])
    assert [p.get("name") for p in out] == ["청년 월세 한시 특별지원", "기초연금"]


# ── 데스크탑앱 서류 자동발급 커버리지 확장(6→11종) 회귀 ──
def test_gov24_doc_coverage_expanded():
    from rpa.gov24_rpa import DOC_CAPP, DOC_URLS, ISSUE_URLS, APPLY_FORM_URLS
    from rpa.manager import SUPPORTED_DOC_NAMES, _SUPPORTED_DOCS
    # gov24 9종 + nhis + work24 = 11
    assert len(DOC_CAPP) == 9
    assert len(SUPPORTED_DOC_NAMES) == 11
    # CDP 검증 5종이 실제로 추가됐고 CappBizCD가 URL에 반영
    for d, capp in {
        "소득금액증명": "12100000021",
        "지방세 납세증명서": "13100000056",
        "지방세 세목별 과세증명서": "13100000084",
        "기초생활수급자 증명서": "14600000280",
        "한부모가족 증명서": "10601000001",
    }.items():
        assert DOC_CAPP[d] == capp
        assert d in _SUPPORTED_DOCS and _SUPPORTED_DOCS[d][0] == "gov24"
        assert capp in APPLY_FORM_URLS[d] and capp in ISSUE_URLS[d] and capp in DOC_URLS[d]
    # 세 URL 맵은 CappBizCD 단일소스에서 생성 → 키 동일
    assert set(DOC_URLS) == set(ISSUE_URLS) == set(APPLY_FORM_URLS) == set(DOC_CAPP)
