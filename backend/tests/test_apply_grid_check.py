# -*- coding: utf-8 -*-
"""복지로 '서비스 선택' 그리드 자동체크 회귀 락(소스 계약).

실측(2026-07-21, 로컬 흐름기록): 기초연금이 커스텀 ARIA 체크박스(div[role=checkbox], 접근성 이름=서비스명)로
렌더돼, 기존 'input[type=checkbox] + 신청하기 텍스트' 패턴에 안 걸려 자동체크가 매번 실패했다(사용자가 매번
수동 체크). → 접근성 이름이 서비스명과 일치하는 role=checkbox 를 직접 클릭하는 로직을 넣었고, 그게 유지되는지
못 박는다. (실브라우저 동작은 로컬 실Chromium 합성 그리드로 검증: 기초연금만 클릭·디코이 무영향.)
"""


def _service_select_fn() -> str:
    src = open("rpa/apply_rpa.py", encoding="utf-8").read()
    return src.split("async def _pass_service_select_page", 1)[1].split("\nasync def ", 1)[0]


def test_service_select_matches_aria_checkbox_by_accessible_name():
    fn = _service_select_fn()
    assert "[role=checkbox]" in fn                 # 커스텀 ARIA 체크박스 대응
    assert "aria-label" in fn                      # 접근성 이름으로 매칭
    assert "o.n === key" in fn                     # 서비스명 '정확 일치' 우선(오버매칭 방지)


def test_service_select_keeps_legacy_fallback():
    """구 패턴(input[type=checkbox] + '신청하기')도 폴백으로 보존 — 다른 서비스 카드 형태 회귀 방지."""
    fn = _service_select_fn()
    assert "신청하기" in fn and "input[type=checkbox]" in fn
