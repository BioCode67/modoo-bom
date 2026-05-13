"""Node 7: portfolio_manager — 복지 포트폴리오 요약"""
from ..state import AgentState, NodeEvent


async def portfolio_manager_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="portfolio_manager", status="running", message="복지 포트폴리오 구성 중...")]

    eligible = [p for p in state.eligible_policies if p.get("eligible")]
    high   = [p for p in eligible if p.get("priority") == "high"]
    medium = [p for p in eligible if p.get("priority") == "medium"]
    low    = [p for p in eligible if p.get("priority") == "low"]

    portfolio = {
        "total_eligible": len(eligible),
        "high_priority_count": len(high),
        "medium_priority_count": len(medium),
        "low_priority_count": len(low),
        "categories": list({p.get("name", "").split()[0] for p in eligible if p.get("name")}),
        "high_priority_policies": [
            {"id": p.get("id"), "name": p.get("name"), "reason": p.get("reason", "")}
            for p in high
        ],
        "all_eligible_names": [p.get("name") for p in eligible],
        "docs_retrieved": sum(1 for d in state.retrieved_docs if d.get("success")),
        "docs_pending":   sum(1 for d in state.retrieved_docs if not d.get("success")),
    }

    new_events.append(NodeEvent(
        node="portfolio_manager",
        status="done",
        message=f"포트폴리오 구성 완료 — 총 {len(eligible)}개 수혜 가능 정책",
        data={"total": len(eligible), "high": len(high)},
    ))

    return {"events": new_events, "portfolio_summary": portfolio}
