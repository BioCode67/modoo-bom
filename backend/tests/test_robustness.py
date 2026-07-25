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


def test_portfolio_annual_amount_excluded_from_monthly_sum():
    """연/1회성 금액(장학금 '연 500만원' 등)은 '월 합계'에서 제외한다(감사: catalog amount_krw를 그대로
    월로 더해 12배 과대계상하던 것). 월 지속 신호가 함께 있으면(연 환산 병기) 월액으로 인정."""
    from agents.nodes.portfolio_manager import _is_annual_or_onetime as f
    assert f("연 500만원 장학금") is True and f("1회 300만원 지급") is True
    assert f("출산 시 일시금 200만원") is True and f("분기별 50만원") is True
    assert f("월 30만원") is False and f("매월 20만원") is False
    assert f("월 100만원 (연 1200만원 상당)") is False  # 월 신호 우선(연 환산 병기)
    assert f("") is False


def test_guide_generator_survives_malformed_llm_guides(monkeypatch):
    """LLM이 스키마를 어겨 guides를 '문자열 리스트'로 줘도 노드가 크래시 없이 완료된다
    (과거 try/except 밖 g.get 루프가 AttributeError로 분석 전체를 중단시키던 잠재 결함 — 감사)."""
    import asyncio
    from agents.nodes import guide_generator as gg
    from agents.state import AgentState

    class _Resp:
        content = '{"guides": ["엉터리 문자열", "또 다른 문자열"]}'

    class _LLM:
        async def ainvoke(self, msgs):
            return _Resp()

    monkeypatch.setattr(gg, "is_mock_mode", lambda: False)
    monkeypatch.setattr(gg, "get_chat_llm", lambda **k: _LLM())
    state = AgentState(eligible_policies=[{"id": "POL-001", "name": "기초연금", "eligible": True, "confidence": 0.9}])
    out = asyncio.new_event_loop().run_until_complete(gg.guide_generator_node(state))
    assert "application_guides" in out and out.get("required_docs") == []  # 예외 없이 반환·비-dict는 스킵


def test_portfolio_estimate_no_false_manwon_on_comma_number():
    """콤마 있는 금액 앞에 무관한 '만'(만 8세 등)이 있어도 1만배 과대계상하지 않는다(감사 실결함).
    과거엔 콤마 제거 전 원문에서 위치를 찾아(find→-1) 문장 앞의 '만'을 오검출했다."""
    from agents.nodes.portfolio_manager import _estimate_monthly_benefit as f
    assert f("", "만 8세 미만 아동에게 100,000원 지급") == 100000       # 10억 아님
    assert f("", "만 65세 이상에게 1,200원 지급") == 1200
    # 정상 '만원' 표기는 그대로 환산(회귀 없음)
    assert f("", "월 20만원") == 200000
    assert f("", "월 최대 500,000원") == 500000


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
    # gov24 13종 + nhis + work24 = 15 (2026-07 AA020 실측 확장 반영)
    assert len(DOC_CAPP) == 13
    assert len(SUPPORTED_DOC_NAMES) == 15
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


# ── 자동신청 일반화: 복지로 딥링크 있으면 임의 정책도 신청(호스트 검증) ──
def test_apply_url_generalization():
    from rpa.apply_rpa import _valid_bokjiro_url, resolve_apply_url, SERVICE_APPLY_URLS, BOKJIRO_SEARCH_URL
    BOK = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00009999"
    # 호스트 검증 — 복지로 https만
    assert _valid_bokjiro_url(BOK)
    assert not _valid_bokjiro_url("https://evil.com/x")
    assert not _valid_bokjiro_url("http://www.bokjiro.go.kr/x")  # http 거부
    assert not _valid_bokjiro_url("https://kosaf.go.kr/x")
    assert not _valid_bokjiro_url("")
    # 딥링크 우선(내장 6종 밖 정책도 신청 가능)
    assert "WLF00009999" in resolve_apply_url("모르는정책", {"apply_url": BOK})
    # 하드코딩 폴백 / 잡URL 무시
    assert resolve_apply_url("기초연금", {}) == SERVICE_APPLY_URLS["기초연금"]
    assert resolve_apply_url("모르는정책", {"apply_url": "https://evil.com"}) == BOKJIRO_SEARCH_URL


def test_resolve_apply_url_known_service_ignores_deeplink():
    # #5 회귀: 알려진 6종은 검증된 하드코딩 URL 우선 — 프로필 딥링크가 서비스와 불일치해도 오염 안 됨.
    from rpa.apply_rpa import resolve_apply_url, SERVICE_APPLY_URLS
    other = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF99999999"
    assert resolve_apply_url("기초연금", {"apply_url": other}) == SERVICE_APPLY_URLS["기초연금"]
    assert resolve_apply_url("아동수당", {"applyUrl": other}) == SERVICE_APPLY_URLS["아동수당"]


def test_bokjiro_autofill_local_typing():
    """복지로 간편인증 자동입력 — 한글 이름은 IME 삽입(영타 방지), 숫자는 실키, 값일치 검증.
    실사용 제보: 복지로 로그인 창에 이름·주민번호·휴대폰이 자동입력 안 되던 것 해소."""
    import asyncio
    from rpa.apply_rpa import _autofill_bokjiro_auth

    typed = []

    class _Kbd:
        async def press(self, k): typed.append(("press", k))
        async def type(self, t, delay=0): typed.append(("type", t))
        async def insert_text(self, t): typed.append(("insert", t))

    class _Loc:
        async def click(self, timeout=None): typed.append(("click", None))
        async def fill(self, v, timeout=None): typed.append(("fill", v))

    class _Ctx:
        async def evaluate(self, js, *a):
            if "setAttribute('data-modoobom-b'" in js and "kind==='phone'" in js:
                return 1  # 마킹 성공
            if "data-modoobom-b" in js and "activeElement" in js:
                return True  # focus 성공
            if "e.value.trim()" in js:
                return True  # 값 일치(성공 판정)
            if "전체동의" in js:
                return True
            return 0
        def locator(self, sel): return _Loc()

    class _Page:
        keyboard = _Kbd()

    out = asyncio.new_event_loop().run_until_complete(
        _autofill_bokjiro_auth([_Ctx()], _Page(),
                               {"name": "김주형", "birth_date": "20010601", "phone": "01012345678"}))
    assert out == {"name": True, "birth": True, "phone": True}
    assert ("insert", "김주형") in typed          # 한글 이름은 IME 삽입(영타 rlatkdtlr 방지)
    assert ("type", "010601") in typed            # 생년월일 앞 6자리는 실키
    assert ("type", "12345678") in typed          # 휴대폰 뒷부분은 실키
    assert ("type", "김주형") not in typed         # 한글을 키 타이핑하지 않음


def test_bokjiro_autofill_partial_and_empty():
    """부분 정보/빈 정보 계약 — 값 없는 필드는 '판정 대상 아님'(True)으로 처리, 실패는 무해."""
    import asyncio
    from rpa.apply_rpa import _autofill_bokjiro_auth

    class _Ctx:
        async def evaluate(self, js, *a):
            return 0  # 모든 마킹 실패(폼 못 찾음) — 실패 경로
        def locator(self, sel):
            class _L:
                async def click(self, timeout=None): pass
                async def fill(self, v, timeout=None): pass
            return _L()

    class _Page:
        class keyboard:
            @staticmethod
            async def type(t, delay=0): pass
            @staticmethod
            async def insert_text(t): pass
            @staticmethod
            async def press(k): pass

    # 값이 아예 없으면 전부 '대상 아님'(True) — 호출부의 _all_filled 판정이 오작동 안 하게
    out = asyncio.new_event_loop().run_until_complete(
        _autofill_bokjiro_auth([_Ctx()], _Page(), {}))
    assert out == {"name": True, "birth": True, "phone": True}
    # 값이 있는데 폼을 못 찾으면 해당 필드만 False(정직) — 사용자 직접 입력 폴백
    out2 = asyncio.new_event_loop().run_until_complete(
        _autofill_bokjiro_auth([_Ctx()], _Page(), {"name": "김주형", "phone": "01011112222"}))
    assert out2["name"] is False and out2["phone"] is False and out2["birth"] is True


def test_landed_matches_guard():
    # 착지 대조 가드: 다른 서비스 상세로 열리면(복지로 ID 재배정) 자동 클릭을 멈추기 위한 판정.
    from rpa.apply_rpa import _landed_matches
    page_wolse = "복지서비스 상세 청년월세 한시 특별지원 신청하기 저소득 청년에게 월세를 지원"
    assert _landed_matches(page_wolse, "청년월세지원")            # 표기 변형은 접두 매칭으로 흡수
    assert _landed_matches("기초연금 상세 안내 신청하기", "기초연금")  # 정확 일치
    assert not _landed_matches("아동수당 상세 안내", "기초연금")      # 딴 서비스 → 자동 클릭 중지
    assert _landed_matches("", "기초연금")                          # 판독 실패(빈 본문)는 통과 — 과차단 금지
    assert _landed_matches("아무 페이지", "")


def test_frontend_backend_apply_deeplink_parity():
    # 프론트 quickApply.KNOWN_APPLY_URLS ↔ 백엔드 SERVICE_APPLY_URLS 의 같은 서비스명은 같은
    # wlfareInfoId 여야 한다 — 어긋나면 버튼과 RPA가 서로 다른 정책 페이지로 이동한다(오신청 위험).
    import pathlib, re as _re
    from rpa.apply_rpa import SERVICE_APPLY_URLS
    ts = (pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "quickApply.ts")
    if not ts.exists():
        return  # 백엔드 단독 배포(번들)에는 프론트 소스가 없다 — 소스트리에서만 검증
    text = ts.read_text(encoding="utf-8")
    fe = {}
    for m in _re.finditer(r"^\s*'?([^'\n:]+?)'?\s*:\s*`\$\{BOKJIRO\}(WLF\d+)`", text, _re.M):
        fe[m.group(1).strip()] = m.group(2)
    assert len(fe) >= 20, f"프론트 딥링크 맵 파싱 실패(발견 {len(fe)}건) — 정규식/파일 구조 확인"
    for name, url in SERVICE_APPLY_URLS.items():
        be_id = _re.search(r"(WLF\d+)", url).group(1)
        if name in fe:
            assert fe[name] == be_id, f"'{name}' 딥링크 불일치: 프론트 {fe[name]} ≠ 백엔드 {be_id}"
    assert fe.get("청년월세지원") == "WLF00004661"  # 데모 핵심 서비스 고정


def test_gov24_form_options_helper_exists():
    # #1 회귀: 폼 옵션 선택 헬퍼가 존재(가족관계 유형·발급목적/연도 미선택 보완). 실동작은 Playwright 필요.
    from rpa import gov24_rpa
    assert callable(getattr(gov24_rpa, "_select_doc_form_options", None))


# ── ETL save_catalog: 원자적 저장(임시파일+os.replace) — 실패해도 기존 파일 보존 ──
class TestEtlAtomicSave:
    def _seed(self, tmp_path):
        out = tmp_path / "policies.json"
        out.write_text(json.dumps([{"id": "OLD-1", "name": "기존"}], ensure_ascii=False),
                       encoding="utf-8")
        return out

    def test_success_replaces_and_cleans_tmp(self, tmp_path):
        from etl.ingest_welfare import save_catalog
        out = self._seed(tmp_path)
        assert save_catalog(out, [{"id": "NEW-1", "name": "새정책"}]) is True
        data = json.loads(out.read_text(encoding="utf-8"))
        assert data[0]["id"] == "NEW-1"
        assert not (tmp_path / "policies.json.tmp").exists()

    def test_creates_parent_dirs(self, tmp_path):
        from etl.ingest_welfare import save_catalog
        out = tmp_path / "a" / "b" / "policies.json"
        assert save_catalog(out, [{"id": "X"}]) is True
        assert json.loads(out.read_text(encoding="utf-8")) == [{"id": "X"}]

    def test_serialization_failure_keeps_original(self, tmp_path):
        # json.dumps 불가 값(set) → False 반환, 원본 무손상, 임시파일 정리
        from etl.ingest_welfare import save_catalog
        out = self._seed(tmp_path)
        assert save_catalog(out, [{"id": "BAD", "tags": {"집합"}}]) is False
        assert json.loads(out.read_text(encoding="utf-8"))[0]["id"] == "OLD-1"
        assert not (tmp_path / "policies.json.tmp").exists()

    def test_oserror_on_replace_keeps_original(self, tmp_path, monkeypatch):
        # 디스크 부족(ENOSPC) 등 os.replace 실패 → False 반환, 원본 무손상, 임시파일 정리
        import errno
        import os as _os
        from etl import ingest_welfare

        out = self._seed(tmp_path)

        def boom(src, dst):
            raise OSError(errno.ENOSPC, "No space left on device")

        monkeypatch.setattr(ingest_welfare.os, "replace", boom)
        assert ingest_welfare.save_catalog(out, [{"id": "NEW-1"}]) is False
        assert json.loads(out.read_text(encoding="utf-8"))[0]["id"] == "OLD-1"
        assert not (tmp_path / "policies.json.tmp").exists()


# ── ETL extract_conditions: 나이 경계 파싱 — _AGE_OPS 딕셔너리화 후에도 동작 동일 ──
class TestEtlAgeConditions:
    def _age(self, text):
        from etl.ingest_welfare import extract_conditions
        return extract_conditions(text).get("age")

    def test_explicit_bounds(self):
        assert self._age("만 65세 이상") == {"min": 65}
        assert self._age("만 18세 초과") == {"min": 19}      # 초과 → min+1 (폐구간 정규화)
        assert self._age("만 34세 이하") == {"max": 34}
        assert self._age("만 40세 미만") == {"max": 39}      # 미만 → max-1

    def test_range_tokens(self):
        assert self._age("만 19세~34세 청년") == {"min": 19, "max": 34}
        assert self._age("20세부터 30세까지") == {"min": 20, "max": 30}
        assert self._age("만 19세 이상 34세 이하") == {"min": 19, "max": 34}

    def test_first_bound_wins(self):
        # 같은 종류 경계가 반복되면 첫 값만 채택
        assert self._age("만 65세 이상, 만 70세 이상 우대") == {"min": 65}

    def test_ambiguous_tokens_ignored(self):
        # 경계어 없는 단독/나열 토큰과 op=None은 KeyError 없이 조용히 무시(오게이트 방지)
        assert self._age("만 20세") is None
        assert self._age("만 20세 또는 25세") is None
        assert self._age("2026세대 지원") is None            # MAX_AGE 초과 잡음 배제

    def test_contradictory_range_dropped(self):
        assert self._age("만 65세 이상 30세 이하") is None    # lo > hi → 통째로 버림
