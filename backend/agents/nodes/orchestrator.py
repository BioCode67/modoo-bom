"""Node 10: orchestrator — 최종 응답 조합 (Mock 폴백 포함)"""
import json
from agents.utils import safe_json_dumps
from ..state import AgentState, NodeEvent
from ..mock_responses import is_mock_mode, mock_final_response
from ..llm import get_chat_llm

_SYSTEM_PROMPT = """당신은 복지 서비스 안내 담당자입니다.
분석 결과를 바탕으로 친절하고 자연스러운 안내 메시지를 3~5문장으로 작성하세요.

규칙:
- 마크다운(**, ##, -, >) 절대 사용 금지
- 일반 텍스트(plain text)로만 작성
- 고령자도 이해할 수 있는 쉬운 언어 사용
- 수혜 가능 정책명과 신청 방법을 자연스럽게 문장에 포함
- 복지로(www.bokjiro.go.kr) 또는 주민센터 안내 포함"""


def _cash_headline(portfolio: dict) -> str:
    """포트폴리오 집계 → '놓치고 있는 현금성 지원 X개, 총 예상수령액 Y원' 헤드라인."""
    if not portfolio:
        return ""
    cnt = portfolio.get("cash_benefit_count") or 0
    monthly = portfolio.get("estimated_monthly_krw") or 0
    if cnt <= 0:
        return ""
    if monthly > 0:
        annual = monthly * 12
        return (f"놓치고 계실 수 있는 현금성 지원이 {cnt}개 있어요. "
                f"예상 수령액은 월 약 {monthly:,}원(연 약 {annual:,}원)입니다.")
    return f"받으실 수 있는 현금성 지원이 {cnt}개 있어요."


async def orchestrator_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="orchestrator", status="running", message="최종 안내 메시지 생성 중...")]

    eligible = [p for p in state.eligible_policies if p.get("eligible")]
    docs_ok  = [d for d in state.retrieved_docs if d.get("success")]
    headline = _cash_headline(state.portfolio_summary)

    llm = None if is_mock_mode() else get_chat_llm(temperature=0.5, max_tokens=1024)
    if llm is None:
        final_response = mock_final_response(
            state.eligible_policies, state.retrieved_docs, state.notifications,
        )
    else:
        from langchain_core.messages import SystemMessage, HumanMessage

        summary = {
            "eligible_policies": [{"name": p.get("name"), "reason": p.get("reason")} for p in eligible],
            "docs_retrieved": [d.get("doc_name") for d in docs_ok],
            "notifications": state.notifications[:3],
            "portfolio": state.portfolio_summary,
        }

        response = await llm.ainvoke([
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=f"분석 결과:\n{safe_json_dumps(summary, indent=2)}"),
        ])
        final_response = str(response.content)

    # 현금성 헤드라인을 최종 안내 맨 앞에 부각(집계가 있을 때만)
    if headline:
        final_response = f"{headline}\n\n{final_response}"

    new_events.append(NodeEvent(
        node="orchestrator",
        status="done",
        message="모든 분석 완료",
        data={"response_length": len(final_response)},
    ))

    return {
        "events": new_events,
        "final_response": final_response,
        "cash_headline": headline,
        "next_action": "end",
    }
