# -*- coding: utf-8 -*-
"""지능형 에이전트(smart_agent) 순수 로직 테스트 — 브라우저·LLM 없이 판단부만 검증.

관찰-판단-실행 중 '판단(decide_heuristic)'과 하이브리드 라우팅(resolve_doc)이
브라우저 없이도 올바른 다음 행동을 고르는지 확인한다(회귀 방지)."""
import local_agent as la
from smart_agent import decide_heuristic, guard_action


def _el(idx, label, kind="click", value=""):
    return {"idx": idx, "kind": kind, "label": label, "value": value, "x": 0, "y": 0}


# ── 실행 직전 안전 게이트(guard_action) — LLM/휴리스틱이 무엇을 골랐든 코드로 막는다(감사 S1/S2) ──

def test_guard_blocks_destructive_click():
    """파괴적 버튼(탈퇴·삭제·로그아웃·철회)은 LLM이 골라도 실행 전 클릭 거부(wait)."""
    for label in ["회원탈퇴", "계정 삭제", "로그아웃", "신청 철회", "회원 해지"]:
        out = guard_action({"action": "click", "idx": 1}, [_el(1, label)], "https://www.gov.kr/x")
        assert out["action"] == "wait", f"{label} 은 클릭 거부돼야 함(실제:{out['action']})"


def test_guard_forces_human_on_final_submit_anywhere():
    """최종 제출/결제/납부류(_SUBMIT)는 어디서든 사람에게(human_submit) — LLM이 눌러도 코드가 막는다."""
    for label in ["제출", "신청완료", "지급신청", "결제", "납부"]:
        out = guard_action({"action": "click", "idx": 1}, [_el(1, label)], "https://www.gov.kr/x")
        assert out["action"] == "human_submit", f"{label} → human_submit(실제:{out['action']})"


def test_guard_welfare_apply_click_goes_to_human():
    """복지로(신청 사이트)의 '신청/제출' 라벨은 사람에게 — '동의하고 신청하기' 합성 라벨(감사 S2)도 포함."""
    for label in ["신청하기", "동의하고 신청하기", "신청", "제출하기", "동의 후 신청"]:
        out = guard_action({"action": "click", "idx": 1}, [_el(1, label)], "https://www.bokjiro.go.kr/apply")
        assert out["action"] == "human_submit", f"복지로 '{label}' → human_submit(실제:{out['action']})"


def test_guard_allows_safe_doc_actions_on_gov24():
    """정부24 문서발급의 안전 진행 버튼(발급하기·문서출력·등본 신청하기·다음)은 그대로 자동 클릭 허용
    (문서 발급은 무료·가역이라 대리 진행 OK — 복지 신청과 구분)."""
    for label in ["발급하기", "문서출력", "신청하기", "다음"]:
        out = guard_action({"action": "click", "idx": 1}, [_el(1, label)], "https://www.gov.kr/AA040")
        assert out["action"] == "click", f"정부24 '{label}' 는 자동 클릭 허용돼야(실제:{out['action']})"


def test_guard_blocks_coordinate_click_on_welfare():
    """좌표 클릭(click_xy)은 라벨 검증 불가 → 복지로에선 금지(오클릭=제출 방지). 정부24 문서발급에선 허용."""
    out = guard_action({"action": "click_xy", "x": 100, "y": 200}, [], "https://www.bokjiro.go.kr/apply")
    assert out["action"] == "human_submit"
    out2 = guard_action({"action": "click_xy", "x": 100, "y": 200}, [], "https://www.gov.kr/AA040")
    assert out2["action"] == "click_xy"


def test_guard_passthrough_non_click_actions():
    """human_auth·done·search·wait 등 클릭 외 액션은 그대로 통과(게이트가 방해하지 않음)."""
    for act in ("human_auth", "done", "search", "wait", "goto"):
        out = guard_action({"action": act}, [], "https://www.bokjiro.go.kr/apply")
        assert out["action"] == act


def test_hybrid_routing_known_doc():
    # 표기 변형('발급' 접미사)이 붙어도 검증된 서류로 라우팅된다.
    assert la.resolve_doc("주민등록등본 발급") == "주민등록등본"
    assert la.resolve_doc("소득금액증명") == "소득금액증명"


def test_hybrid_routing_unknown_goes_to_llm():
    # 미검증 서류는 None → 지능형(LLM/휴리스틱) 탐색 경로로 넘어간다.
    # (병역증명서 ≠ 병적증명서 — 다른 서류라 부분일치로 오라우팅되지 않아야 함)
    assert la.resolve_doc("병역증명서") is None
    assert la.resolve_doc("여권 재발급") is None


def test_resolve_doc_ambiguous_returns_none_not_wrong_doc():
    """모호한 축약 질의는 삽입순서상 먼저인 서류를 조용히 고르지 않고 None(감사 C1) — 엉뚱한 인증·PII 서류
    대리발급 방지. 국세/지방세 '납세증명서'처럼 양쪽에 걸리는 질의가 대표 사례."""
    assert la.resolve_doc("납세증명서") is None    # 국세·지방세 양쪽 → 모호
    assert la.resolve_doc("지방세") is None         # 지방세 납세/세목별 → 모호
    assert la.resolve_doc("증명서") is None         # 다수 → 모호
    # 구체적이면 정확히 라우팅(모호 방지가 정상 라우팅을 막지 않음)
    assert la.resolve_doc("국세 납세증명서") == "국세 납세증명서"
    assert la.resolve_doc("지방세 납세증명서") == "지방세 납세증명서"
    assert la.resolve_doc("국세") == "국세 납세증명서"      # '국세'는 국세 납세증명서에만 걸림(유일)
    assert la.resolve_doc("등본") == "주민등록등본"         # 축약이라도 유일하면 채택
    assert la.resolve_doc("출입국") == "출입국에 관한 사실증명"
    assert la.resolve_doc("병적증명서") == "병적증명서"     # 신규 4종도 정확 라우팅


def test_cdp_path_neutralizes_window_print():
    """CDP 데스크탑 경로(local_agent/smart_agent 공용 get_page)도 window.print를 무력화해 발급페이지의
    네이티브 인쇄창 렌더러 동결(서버 RPA가 이미 막는 감사 CRITICAL)을 방지해야 한다(감사 H1)."""
    src = open("local_agent.py", encoding="utf-8").read()
    assert "NO_PRINT_SCRIPT" in src and "window.print" in src
    assert "add_init_script(NO_PRINT_SCRIPT)" in src   # 컨텍스트 주입(이후 이동·팝업 모두 적용)


def test_desktop_docs_aligned_with_server_rpa():
    """데스크탑 CDP 경로(local_agent.DOCS)와 서버 RPA(gov24_rpa.DOC_CAPP)의 CappBizCD가 일치해야 한다 —
    같은 서류를 같은 정부24 AA040 흐름으로 발급하므로 두 맵이 갈라지면 데스크탑앱이 조용히 서버보다
    뒤처진다(드리프트 방지, CLAUDE.md '반드시 일치'). '가족관계증명서'만 별도 발급 흐름이라 데스크탑에서 제외."""
    from rpa.gov24_rpa import DOC_CAPP
    # ① 데스크탑의 모든 서류는 서버 맵에 '같은 CappBizCD'로 존재해야 한다(잘못된 코드로 발급 시도 방지)
    for name, capp in la.DOCS.items():
        assert DOC_CAPP.get(name) == capp, f"{name}: 데스크탑 {capp} vs 서버 {DOC_CAPP.get(name)}"
    # ② 서버에만 있고 데스크탑에 없는 서류는 의도적 제외('가족관계증명서')뿐이어야 한다 —
    #    서버에 새 서류가 추가되면 이 테스트가 실패해, 데스크탑 확장/제외를 '의식적으로' 결정하게 한다.
    server_only = [k for k in DOC_CAPP if k not in la.DOCS]
    assert server_only == ["가족관계증명서"], f"정합성 확인 필요 — 서버 전용 서류: {server_only}"
    # ③ 데스크탑 원-로그인 즉시발급이 12종 이상(회귀로 줄지 않게 하한 고정)
    assert len(la.DOCS) >= 12


def test_heuristic_picks_simple_auth_at_login():
    # 로그인 화면: 여러 인증수단 중 '간편인증'을 우선 선택.
    els = [_el(1, "공동인증서"), _el(2, "간편인증"), _el(3, "금융인증서")]
    action = decide_heuristic("주민등록등본", "https://plus.gov.kr/login", els, [])
    assert action["action"] == "click"
    assert action["idx"] == 2


def test_heuristic_picks_issue_button():
    # 발급 화면: '발급하기' 진행 버튼을 고른다.
    els = [_el(1, "안내"), _el(2, "발급하기"), _el(3, "취소")]
    action = decide_heuristic("주민등록등본", "https://www.gov.kr/AA020", els, [])
    assert action["action"] == "click"
    assert action["idx"] == 2


def test_heuristic_skips_non_member():
    # '비회원 신청'은 건너뛰고 정식 버튼을 고른다. '신청하기'는 최종 제출이라 사람에게 넘긴다(human_submit).
    els = [_el(1, "비회원 신청하기"), _el(2, "신청하기")]
    action = decide_heuristic("아동수당", "https://www.gov.kr/AA020", els, [])
    assert action["idx"] == 2
    assert action["action"] == "human_submit"


def test_heuristic_never_clicks_destructive():
    # 파괴적/이탈 버튼(신청취소·회원탈퇴·삭제확인)은 키워드가 겹쳐도 절대 자동 클릭하지 않는다.
    for bad in ["신청취소", "회원탈퇴 신청하기", "정말 삭제하시겠습니까? 확인", "로그아웃"]:
        els = [_el(1, bad)]
        action = decide_heuristic("주민등록등본", "https://www.gov.kr", els, [])
        assert action["action"] != "click", f"{bad}를 클릭하면 안 됨"


def test_heuristic_final_submit_goes_to_human():
    # 최종 제출류(제출/신청하기)는 대리하지 않고 사람에게 넘긴다(비가역·법적 행위).
    for submit in ["제출", "신청하기", "지급신청", "최종 신청"]:
        els = [_el(1, submit)]
        action = decide_heuristic("주민등록등본", "https://www.gov.kr", els, [])
        assert action["action"] == "human_submit", f"{submit}는 human_submit이어야 함"


def test_heuristic_safe_button_over_submit():
    # 안전 진행 버튼(발급하기)이 있으면 최종 제출류보다 먼저 자동 클릭한다.
    els = [_el(1, "신청하기"), _el(2, "발급하기")]
    action = decide_heuristic("주민등록등본", "https://www.gov.kr", els, [])
    assert action["action"] == "click" and action["idx"] == 2


def test_heuristic_pingpong_guard():
    # 같은 버튼을 2번 이상 누른 이력이면 건너뛴다(A-B-A-B 핑퐁으로 24스텝 낭비 방지).
    els = [_el(1, "다음")]
    hist = ["click 다음 → click", "click 확인 → click", "click 다음 → click"]
    action = decide_heuristic("주민등록등본", "https://www.gov.kr", els, hist)
    assert action["action"] != "click"  # '다음'은 이미 2회+ → 재클릭 안 함


def test_heuristic_auth_by_iframe_url():
    # 본인인증 위젯(simpleCert iframe)이 감지되면 라벨과 무관하게 사람에게 넘긴다.
    els = [{"idx": 1, "kind": "text-input", "label": "이름", "value": "",
            "x": 0, "y": 0, "frame_url": "https://plus.gov.kr/simpleCert.html"}]
    action = decide_heuristic("주민등록등본", "https://plus.gov.kr/login", els, [])
    assert action["action"] == "human_auth"


def test_heuristic_waits_when_no_progress_button():
    # 진행 버튼도 검색칸도 없으면 무리한 클릭 대신 대기(오작동 방지).
    els = [_el(1, "로그아웃"), _el(2, "홈으로")]
    action = decide_heuristic("주민등록등본", "https://www.gov.kr", els, [])
    assert action["action"] == "wait"


def test_heuristic_searches_unknown_doc():
    # 진행 버튼이 없고 검색칸이 있으면 → 처음 보는 서류를 사이트 검색으로 찾는다('발급' 동작어 제거).
    els = [_el(1, "로그아웃"), _el(2, "검색어 입력", kind="search-input")]
    action = decide_heuristic("병역증명서 발급", "https://www.gov.kr", els, [])
    assert action["action"] == "search"
    assert action["idx"] == 2
    assert action["value"] == "병역증명서"  # 동작어 '발급' 제거된 서류명


def test_heuristic_does_not_search_twice():
    # 이미 검색했다면 같은 검색을 반복하지 않는다(무한루프 방지).
    els = [_el(1, "검색어 입력", kind="search-input")]
    hist = ["search 검색어 입력 → search"]
    action = decide_heuristic("병역증명서", "https://www.gov.kr", els, hist)
    assert action["action"] == "wait"
