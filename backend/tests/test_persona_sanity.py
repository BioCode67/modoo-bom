"""페르소나 상식 정합 회귀 — 전체 그래프(Mock)가 부적합 정책을 추천하지 않음을 고정.

2026-07-19 풀스택 실구동 QA에서 5개 페르소나 전수 검증한 결과를 테스트로 고정한다:
연령·가구형태·생애이벤트에 맞는 정책은 나오고(기대), 명백히 부적합한 정책은
절대 나오지 않아야 한다(금지). 검색(하이브리드)·자격판정(mock 규칙)·키워드 추출
어느 한 곳이 무너져도 여기서 잡힌다.
"""
import pytest

from agents.graph import build_graph
from agents.state import AgentState, UserProfile

PERSONAS = [
    ("72세 저소득 독거",
     dict(age=72, gender="female", region="서울특별시", household_type="단독가구", income_percentile=30),
     ["청년월세", "청년 월세", "청년도약", "청년미래", "아동수당", "부모급여", "첫만남"],
     ["기초연금"]),
    ("25세 저소득 실직 청년",
     dict(age=25, gender="male", region="부산광역시", household_type="단독가구", income_percentile=45,
          employment_status="unemployed"),
     ["기초연금", "노인 일자리", "장수수당", "부모급여"],
     ["청년"]),
    ("38세 한부모 + 5세 자녀",
     dict(age=38, gender="female", region="경기도", household_type="한부모가족", income_percentile=40,
          has_children=True, children_ages=[5]),
     ["기초연금", "청년 월세", "청년월세", "노인 일자리"],
     ["한부모", "아동수당"]),
    ("45세 중증장애 저소득",
     dict(age=45, gender="male", region="대구광역시", household_type="단독가구", income_percentile=35,
          disability=True),
     ["기초연금", "아동수당", "청년"],
     ["장애"]),
    ("31세 신생아 출산 가구",
     dict(age=31, gender="female", region="인천광역시", household_type="부부가구", income_percentile=60,
          has_children=True, children_ages=[0], life_events=["출산"]),
     ["기초연금", "노인"],
     ["부모급여", "첫만남"]),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("label,profile_kw,forbidden,expected", PERSONAS, ids=[p[0] for p in PERSONAS])
async def test_persona_recommendations_are_sane(label, profile_kw, forbidden, expected):
    graph = build_graph()
    state = AgentState(user_profile=UserProfile(name="테스트", **profile_kw))
    result = await graph.ainvoke(state.model_dump())
    names = [
        (p.get("policy_name") or p.get("name") or "")
        for p in (result.get("eligible_policies") or [])
    ]
    assert names, f"{label}: 추천 0건 — 파이프라인 붕괴 의심"
    bad = [k for k in forbidden if any(k in n for n in names)]
    assert not bad, f"{label}: 부적합 추천 {bad} — 결과 {names[:8]}"
    missing = [k for k in expected if not any(k in n for n in names)]
    assert not missing, f"{label}: 기대 정책 누락 {missing} — 결과 {names[:8]}"
