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
    # '비회원 신청'은 건너뛰고 정식 진행 버튼을 고른다(잘못된 분기 방지).
    els = [_el(1, "비회원 신청하기"), _el(2, "신청하기")]
    action = decide_heuristic("아동수당", "https://www.gov.kr/AA020", els, [])
    assert action["idx"] == 2


def test_heuristic_waits_when_no_progress_button():
    # 진행 버튼이 없으면 무리한 클릭 대신 대기(오작동 방지).
    els = [_el(1, "로그아웃"), _el(2, "홈으로")]
    action = decide_heuristic("주민등록등본", "https://www.gov.kr", els, [])
    assert action["action"] == "wait"
