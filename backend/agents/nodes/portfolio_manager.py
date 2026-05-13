"""Node 7: portfolio_manager — 복지 포트폴리오 요약"""
import re
from ..state import AgentState, NodeEvent


def _estimate_monthly_benefit(policy_name: str, benefit_text: str) -> int:
    """benefit 텍스트에서 월 금액 추출 (원 단위). 없으면 0."""
    # "월 최대 N원" / "월 N만원" 패턴
    patterns = [
        r"월\s*최대?\s*([\d,]+)원",
        r"월\s*([\d,]+)만?\s*원",
        r"([\d,]+)원\s*지급",
    ]
    for pat in patterns:
        m = re.search(pat, benefit_text.replace(" ", ""))
        if m:
            raw = m.group(1).replace(",", "")
            val = int(raw)
            # "만원" 단위 처리
            if "만" in benefit_text[max(0, benefit_text.find(raw)-2):benefit_text.find(raw)+len(raw)+3]:
                val *= 10000
            return val
    return 0


async def portfolio_manager_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="portfolio_manager", status="running", message="복지 포트폴리오 구성 중...")]

    eligible = [p for p in state.eligible_policies if p.get("eligible")]
    high   = [p for p in eligible if p.get("priority") == "high"]
    medium = [p for p in eligible if p.get("priority") == "medium"]
    low    = [p for p in eligible if p.get("priority") == "low"]

    # 샘플 데이터에서 benefit 텍스트 매핑
    from rag.sample_data import WELFARE_POLICIES
    policy_benefit_map = {p["id"]: p.get("benefit", "") for p in WELFARE_POLICIES}

    total_monthly = 0
    for p in eligible:
        benefit_text = policy_benefit_map.get(p.get("id", ""), "")
        total_monthly += _estimate_monthly_benefit(p.get("name", ""), benefit_text)

    portfolio = {
        "total_eligible": len(eligible),
        "high_priority_count": len(high),
        "medium_priority_count": len(medium),
        "low_priority_count": len(low),
        "total_benefit_amount": total_monthly,
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
