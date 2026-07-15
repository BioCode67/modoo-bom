"""Mock 모드 자격 게이트 회귀(감사 2026-07) — 프론트 welfare-engine과 패리티.
langgraph 없이 mock_responses 순수 함수만 검증(그래프 미의존)."""
from types import SimpleNamespace
from agents.mock_responses import _income_ceiling, _check_policy


def _profile(**over):
    base = dict(age=30, gender="other", income_percentile=50, disability=False,
                household_type="", has_children=False, children_ages=[], is_pregnant=False,
                employment_status="", life_events=[], region="")
    base.update(over)
    return SimpleNamespace(**base)


# ── 부모/부양의무자 소득요건이 본인 상한을 덮지 않음(감사 HIGH) ──
def test_income_ceiling_excludes_parent_threshold():
    assert _income_ceiling("만 19~34세, 기준 중위소득 60% 이하, 부모 소득 중위 100% 이하") == 60
    assert _income_ceiling("기준 중위소득 50% 이하, 부양의무자 소득 중위 120% 이하") == 50
    # '가구 중위소득'은 본인 가구 → 유지
    assert _income_ceiling("가구 중위소득 80% 이하") == 80
    # 본인 단일 상한은 그대로
    assert _income_ceiling("기준 중위소득 100% 이하") == 100


def test_income_gate_rejects_over_ceiling_youth():
    doc = "만 19~34세, 독립 거주, 기준 중위소득 60% 이하, 부모 소득 중위 100% 이하"
    # 중위 90% 청년은 본인 상한(60) 초과 → 부적격이어야(부모 100이 덮으면 버그)
    ok, *_ = _check_policy(doc, "청년월세", "POL-055", _profile(age=27, income_percentile=90))
    assert ok is False
    # 중위 55% 청년은 적격
    ok2, *_ = _check_policy(doc, "청년월세", "POL-055", _profile(age=27, income_percentile=55))
    assert ok2 is True


# ── 만 66세는 60~65세를 포함하지 않음(감사) ──
def test_age_gate_66_excludes_60_to_65():
    doc = "만 66세 이상 생애전환기 건강검진"
    ok62, *_ = _check_policy(doc, "노인 건강검진", "POL-109", _profile(age=62, income_percentile=50))
    assert ok62 is False
    ok66, *_ = _check_policy(doc, "노인 건강검진", "POL-109", _profile(age=66, income_percentile=50))
    assert ok66 is True


def test_age_gate_60_still_starts_at_60():
    doc = "만 60세 이상 대상"
    ok60, *_ = _check_policy(doc, "테스트", "T", _profile(age=60, income_percentile=50))
    assert ok60 is True
    ok59, *_ = _check_policy(doc, "테스트", "T", _profile(age=59, income_percentile=50))
    assert ok59 is False
