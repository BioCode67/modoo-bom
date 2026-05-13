"""LangGraph StateGraph 공유 상태 정의"""
from __future__ import annotations
import operator
from typing import Annotated, Any, Literal
from pydantic import BaseModel, Field


class UserProfile(BaseModel):
    model_config = {"extra": "ignore"}

    name: str = ""
    age: int = 0
    gender: Literal["male", "female", "other"] = "other"
    region: str = ""
    household_type: str = ""
    income_percentile: float = 0.0
    disability: bool = False
    disability_grade: str = ""
    employment_status: str = ""
    has_children: bool = False
    children_ages: list[int] = Field(default_factory=list)
    is_pregnant: bool = False
    life_events: list[str] = Field(default_factory=list)


class NodeEvent(BaseModel):
    node: str
    status: Literal["running", "done", "error"]
    message: str = ""
    data: Any = None


class AgentState(BaseModel):
    """
    LangGraph StateGraph 공유 상태.

    events 필드는 operator.add 리듀서를 사용해 각 노드가 반환하는
    새 이벤트만 추가하면 LangGraph가 자동으로 누적합니다.
    """
    model_config = {"arbitrary_types_allowed": True}

    # 입력
    user_profile: UserProfile = Field(default_factory=UserProfile)
    query: str = ""

    # operator.add → 각 노드가 NEW 이벤트만 반환하면 자동 append
    events: Annotated[list[NodeEvent], operator.add] = Field(default_factory=list)

    # Node 1: profile_analyzer
    profile_summary: str = ""
    search_keywords: list[str] = Field(default_factory=list)

    # Node 2: policy_search
    retrieved_policies: list[dict] = Field(default_factory=list)

    # Node 3: eligibility_check
    eligible_policies: list[dict] = Field(default_factory=list)
    eligibility_reasoning: str = ""

    # Node 4: reflection_check
    reflection_passed: bool = False
    reflection_issues: list[str] = Field(default_factory=list)
    retry_count: int = 0

    # Node 5: guide_generator
    application_guides: list[dict] = Field(default_factory=list)

    # Node 6: doc_retrieval
    required_docs: list[str] = Field(default_factory=list)
    retrieved_docs: list[dict] = Field(default_factory=list)

    # Node 7: portfolio_manager
    portfolio_summary: dict = Field(default_factory=dict)

    # Node 8: notification_agent
    notifications: list[dict] = Field(default_factory=list)

    # Node 9: result_tracker
    tracked_applications: list[dict] = Field(default_factory=list)

    # Node 10: orchestrator
    next_action: str = "profile_analyzer"
    final_response: str = ""
    error: str = ""
