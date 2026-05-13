"""Node 6: doc_retrieval — 정부24 API Mock 서류 자동 취득"""
from mocks.gov24_api import issue_documents_batch
from ..state import AgentState, NodeEvent

AUTO_ISSUABLE = [
    "주민등록등본", "주민등록초본", "가족관계증명서",
    "건강보험 자격득실확인서", "고용보험 피보험자격 이력내역서",
]


async def doc_retrieval_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="doc_retrieval", status="running", message="서류 자동 취득 중 (정부24 API)...")]

    required_docs = state.required_docs
    if not required_docs:
        new_events.append(NodeEvent(node="doc_retrieval", status="done", message="취득할 서류 없음"))
        return {"events": new_events, "retrieved_docs": []}

    user_name = state.user_profile.name or "사용자"
    target_docs = [d for d in required_docs if d in AUTO_ISSUABLE]
    manual_docs = [d for d in required_docs if d not in AUTO_ISSUABLE]

    results = await issue_documents_batch(target_docs, user_name)

    for doc in manual_docs:
        results.append({
            "success": False,
            "doc_name": doc,
            "error": "온라인 자동 발급 미지원",
            "fallback_message": "주민센터 직접 방문 또는 해당 기관 홈페이지에서 발급하세요.",
            "manual_required": True,
        })

    success_count = sum(1 for r in results if r.get("success"))
    failed_count = len(results) - success_count

    new_events.append(NodeEvent(
        node="doc_retrieval",
        status="done",
        message=f"자동 취득 {success_count}건 완료 / 수동 {failed_count}건",
        data={"success": success_count, "failed": failed_count, "manual": len(manual_docs)},
    ))

    return {"events": new_events, "retrieved_docs": results}
