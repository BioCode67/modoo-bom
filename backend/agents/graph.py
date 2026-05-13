"""LangGraph StateGraph 10노드 구성"""
from langgraph.graph import StateGraph, END
from .state import AgentState
from .nodes.profile_analyzer import profile_analyzer_node
from .nodes.policy_search import policy_search_node
from .nodes.eligibility_check import eligibility_check_node
from .nodes.reflection_check import reflection_check_node
from .nodes.guide_generator import guide_generator_node
from .nodes.doc_retrieval import doc_retrieval_node
from .nodes.portfolio_manager import portfolio_manager_node
from .nodes.notification_agent import notification_agent_node
from .nodes.result_tracker import result_tracker_node
from .nodes.orchestrator import orchestrator_node

MAX_RETRIES = 2


def _route_after_reflection(state: AgentState) -> str:
    """Reflection 결과에 따라 재판별 또는 다음 단계 진행"""
    if state.reflection_passed or state.retry_count >= MAX_RETRIES:
        return "guide_generator"
    return "eligibility_check"


def build_graph() -> StateGraph:
    """
    10노드 LangGraph StateGraph 구성:
    1. profile_analyzer
    2. policy_search
    3. eligibility_check
    4. reflection_check  (→ 재판별 loop 또는 통과)
    5. guide_generator
    6. doc_retrieval
    7. portfolio_manager
    8. notification_agent
    9. result_tracker
    10. orchestrator
    """
    graph = StateGraph(AgentState)

    # 노드 등록
    graph.add_node("profile_analyzer", profile_analyzer_node)
    graph.add_node("policy_search", policy_search_node)
    graph.add_node("eligibility_check", eligibility_check_node)
    graph.add_node("reflection_check", reflection_check_node)
    graph.add_node("guide_generator", guide_generator_node)
    graph.add_node("doc_retrieval", doc_retrieval_node)
    graph.add_node("portfolio_manager", portfolio_manager_node)
    graph.add_node("notification_agent", notification_agent_node)
    graph.add_node("result_tracker", result_tracker_node)
    graph.add_node("orchestrator", orchestrator_node)

    # 엣지 연결
    graph.set_entry_point("profile_analyzer")
    graph.add_edge("profile_analyzer", "policy_search")
    graph.add_edge("policy_search", "eligibility_check")
    graph.add_edge("eligibility_check", "reflection_check")

    # Reflection Loop: 실패 시 eligibility_check 재실행
    graph.add_conditional_edges(
        "reflection_check",
        _route_after_reflection,
        {
            "guide_generator": "guide_generator",
            "eligibility_check": "eligibility_check",
        },
    )

    graph.add_edge("guide_generator", "doc_retrieval")
    graph.add_edge("doc_retrieval", "portfolio_manager")
    graph.add_edge("portfolio_manager", "notification_agent")
    graph.add_edge("notification_agent", "result_tracker")
    graph.add_edge("result_tracker", "orchestrator")
    graph.add_edge("orchestrator", END)

    return graph.compile()


# 싱글턴 그래프 인스턴스
_app = None


def get_graph():
    global _app
    if _app is None:
        _app = build_graph()
    return _app
