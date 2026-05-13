"""Node 10: orchestrator — 최종 응답 조합 (Mock 폴백 포함)"""
import json
from ..state import AgentState, NodeEvent
from ..mock_responses import is_mock_mode, mock_final_response

_SYSTEM_PROMPT = """당신은 복지 서비스 AI 어시스턴트입니다.
분석 결과를 바탕으로 친절하고 명확한 최종 안내 메시지를 마크다운으로 작성하세요.
고령자도 이해할 수 있도록 쉬운 언어를 사용하고, 핵심 내용을 먼저 제시하세요."""


async def orchestrator_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="orchestrator", status="running", message="최종 안내 메시지 생성 중...")]

    eligible = [p for p in state.eligible_policies if p.get("eligible")]
    docs_ok  = [d for d in state.retrieved_docs if d.get("success")]

    if is_mock_mode():
        final_response = mock_final_response(
            state.eligible_policies, state.retrieved_docs, state.notifications,
        )
    else:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage

        summary = {
            "eligible_policies": [{"name": p.get("name"), "reason": p.get("reason")} for p in eligible],
            "docs_retrieved": [d.get("doc_name") for d in docs_ok],
            "notifications": state.notifications[:3],
            "portfolio": state.portfolio_summary,
        }

        llm = ChatOpenAI(model="gpt-4o", temperature=0.5)
        response = await llm.ainvoke([
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=f"분석 결과:\n{json.dumps(summary, ensure_ascii=False, indent=2)}"),
        ])
        final_response = response.content

    new_events.append(NodeEvent(
        node="orchestrator",
        status="done",
        message="모든 분석 완료",
        data={"response_length": len(final_response)},
    ))

    return {
        "events": new_events,
        "final_response": final_response,
        "next_action": "end",
    }
