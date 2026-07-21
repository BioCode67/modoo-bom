"""프론트(welfare-engine) ↔ 백엔드 목모드 패리티 회귀 방지 — 금액 파싱·소득상한.

다중에이전트 감사에서 확정된 '프론트는 고쳤는데 백엔드 쌍둥이는 안 고쳐진' 패리티 깨짐 2건:
 1) _estimate_monthly_benefit: '월 최대 N만원'을 0으로 과소계산(정책 금액 누락)
 2) _income_ceiling: '차상위 우선/우대'(우대)를 하드 소득상한 50%로 오게이트(51~100%ile 부당배제)
"""
from agents.nodes.portfolio_manager import _estimate_monthly_benefit as est
from agents.mock_responses import _income_ceiling as ceil


def test_estimate_handles_won_man_notation():
    # 버그: 숫자와 '원' 사이에 '만'이 오는 '월 최대 20만원'을 놓쳐 0이 나오던 것 → 프론트 parseMonthly와 일치
    assert est("x", "월 최대 20만원") == 200000
    assert est("x", "월 최대 65만원") == 650000
    assert est("x", "월 최대 20만 원") == 200000
    # keep-green — 원 단위·만원 없는 표기는 그대로
    assert est("x", "월 최대 349,700원") == 349700
    assert est("x", "월 30만원") == 300000
    assert est("x", "월 최대 500,000원") == 500000
    assert est("x", "지원 없음") == 0


def test_income_ceiling_excludes_preference():
    # 버그: '우대·우선' 표현을 하드 소득상한으로 오인 → 우대 괄호군·괄호 밖 우대·부정어를 걷어낸 뒤 판정
    assert ceil("만 19~34세 (기초생활수급자·차상위 우선)") is None
    assert ceil("차상위 우선 선정") is None
    assert ceil("수급자 우선") is None
    assert ceil("미수급자") is None
    # keep-green — 실제 하드 요건은 그대로 50/해당 %
    assert ceil("차상위계층 이하") == 50
    assert ceil("기초생활수급자") == 50
    assert ceil("생계·의료급여 수급 가구") == 50
    assert ceil("중위소득 60% 이하") == 60
