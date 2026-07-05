# -*- coding: utf-8 -*-
"""지능형 에이전트(smart_agent) 순수 로직 테스트 — 브라우저·LLM 없이 판단부만 검증.

관찰-판단-실행 중 '판단(decide_heuristic)'과 하이브리드 라우팅(resolve_doc)이
브라우저 없이도 올바른 다음 행동을 고르는지 확인한다(회귀 방지)."""
import local_agent as la
from smart_agent import decide_heuristic


def _el(idx, label, kind="click", value=""):
    return {"idx": idx, "kind": kind, "label": label, "value": value, "x": 0, "y": 0}


def test_hybrid_routing_known_doc():
    # 표기 변형('발급' 접미사)이 붙어도 검증된 서류로 라우팅된다.
    assert la.resolve_doc("주민등록등본 발급") == "주민등록등본"
    assert la.resolve_doc("소득금액증명") == "소득금액증명"


def test_hybrid_routing_unknown_goes_to_llm():
    # 미검증 서류는 None → 지능형(LLM/휴리스틱) 탐색 경로로 넘어간다.
    assert la.resolve_doc("병역증명서") is None
    assert la.resolve_doc("여권 재발급") is None


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
