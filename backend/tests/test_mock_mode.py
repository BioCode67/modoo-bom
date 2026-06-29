"""Mock 모드 동작 검증 — ANTHROPIC_API_KEY 없이 전체 플로우 테스트"""
import asyncio
import os
import pytest

os.environ.pop("ANTHROPIC_API_KEY", None)  # 미설정 → Mock 모드


# ── 유닛 테스트 ────────────────────────────────────────────────────────────────

def test_is_mock_mode():
    from agents.mock_responses import is_mock_mode
    assert is_mock_mode() is True


def test_sample_data_count():
    from rag.sample_data import WELFARE_POLICIES
    assert len(WELFARE_POLICIES) == 120
    # 필수 필드 확인
    for p in WELFARE_POLICIES:
        assert "id" in p
        assert "name" in p
        assert "eligibility" in p
        assert "required_docs" in p


def test_mock_profile_analysis():
    from agents.mock_responses import mock_profile_analysis
    from agents.state import UserProfile

    profile = UserProfile(name="박순자", age=72, region="경기도",
                          household_type="단독가구", income_percentile=35,
                          employment_status="retired", life_events=["만65세"])
    result = mock_profile_analysis(profile)

    assert "summary" in result
    assert "keywords" in result
    assert len(result["keywords"]) > 0
    assert any("노인" in k or "기초연금" in k for k in result["keywords"])


def test_mock_search_elderly():
    from agents.nodes.policy_search import _mock_search
    from agents.state import UserProfile

    profile = UserProfile(age=72, income_percentile=35, employment_status="retired")
    results = _mock_search(profile)

    assert len(results) >= 5
    names = [r["name"] for r in results]
    assert "기초연금" in names


def test_mock_search_young():
    from agents.nodes.policy_search import _mock_search
    from agents.state import UserProfile

    profile = UserProfile(age=26, income_percentile=55, employment_status="unemployed",
                          life_events=["실직"])
    results = _mock_search(profile)

    assert len(results) >= 5


def test_mock_eligibility_elderly():
    from agents.mock_responses import mock_eligibility
    from agents.state import UserProfile

    profile = UserProfile(age=72, income_percentile=35)
    # 기초연금 정책 하나만 테스트
    policies = [{
        "id": "POL-001",
        "name": "기초연금",
        "document": "정책명: 기초연금\n자격요건: 만 65세 이상, 소득 하위 70%\n대상: 만 65세 이상 노인",
    }]
    result = mock_eligibility(policies, profile)

    assert "eligible_policies" in result
    eligible = [p for p in result["eligible_policies"] if p["eligible"]]
    assert len(eligible) == 1
    assert eligible[0]["name"] == "기초연금"


def test_mock_reflection_no_issues():
    from agents.mock_responses import mock_reflection
    from agents.state import UserProfile

    profile = UserProfile(age=72)
    eligible = [{"id": "POL-001", "name": "기초연금", "eligible": True, "reason": "만 65세 이상"}]
    result = mock_reflection(eligible, profile)

    assert result["passed"] is True
    assert isinstance(result["issues"], list)


def test_mock_reflection_age_mismatch():
    from agents.mock_responses import mock_reflection
    from agents.state import UserProfile

    profile = UserProfile(age=40)
    # 노인 정책이 40세에게 적합으로 잘못 판별된 경우
    eligible = [{"id": "POL-010", "name": "노인 일자리 및 사회활동 지원", "eligible": True}]
    result = mock_reflection(eligible, profile)

    assert result["passed"] is False
    assert len(result["issues"]) > 0


def test_gov24_mock_issue():
    result = asyncio.get_event_loop().run_until_complete(
        __import__("mocks.gov24_api", fromlist=["issue_document"]).issue_document("주민등록등본", "홍길동")
    )
    assert result["success"] is True
    assert result["doc_name"] == "주민등록등본"
    assert "receipt_number" in result


def test_gov24_mock_unsupported():
    result = asyncio.get_event_loop().run_until_complete(
        __import__("mocks.gov24_api", fromlist=["issue_document"]).issue_document("지원안되는서류", "홍길동")
    )
    assert result["success"] is False
    assert "error" in result


# ── 통합 테스트: 전체 그래프 Mock 실행 ────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_graph_mock_elderly():
    """독거 노인 프로필로 전체 LangGraph 플로우 실행"""
    from agents.graph import build_graph
    from agents.state import AgentState, UserProfile

    graph = build_graph()
    profile = UserProfile(
        name="박순자", age=72, gender="female", region="경기도",
        household_type="단독가구", income_percentile=35,
        employment_status="retired", life_events=["만65세"],
    )
    initial = AgentState(user_profile=profile, query="노인 복지 혜택")

    final_state = await graph.ainvoke(initial.model_dump())

    assert final_state is not None
    assert len(final_state.get("eligible_policies", [])) > 0
    assert len(final_state.get("events", [])) >= 10  # 최소 노드당 2이벤트 이상
    assert final_state.get("final_response", "") != ""


@pytest.mark.asyncio
async def test_full_graph_mock_youth():
    """청년 실직자 프로필"""
    from agents.graph import build_graph
    from agents.state import AgentState, UserProfile

    graph = build_graph()
    profile = UserProfile(
        name="이민준", age=26, gender="male", region="서울특별시",
        household_type="단독가구", income_percentile=55,
        employment_status="unemployed", life_events=["실직"],
    )
    initial = AgentState(user_profile=profile)

    final_state = await graph.ainvoke(initial.model_dump())

    assert final_state is not None
    assert final_state.get("profile_summary", "") != ""
