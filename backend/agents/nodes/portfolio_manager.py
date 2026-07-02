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

    # 금액/현금성 조회: 시드(sample_data) + 실데이터 카탈로그(policies.json의 amount_krw/is_cash) 병합
    from rag.sample_data import WELFARE_POLICIES
    policy_benefit_map = {p["id"]: p.get("benefit", "") for p in WELFARE_POLICIES}
    try:
        from rag.catalog_loader import load_catalog
        catalog_map = {p.get("id"): p for p in load_catalog()}
    except Exception:
        catalog_map = {}

    total_monthly = 0
    cash_count = 0
    for p in eligible:
        pid = p.get("id", "")
        cat = catalog_map.get(pid, {})
        # 카탈로그에 파생된 실제 금액이 있으면 우선, 없으면 시드 benefit 텍스트에서 추출
        amt = cat.get("amount_krw") or _estimate_monthly_benefit(
            p.get("name", ""), policy_benefit_map.get(pid, "") or cat.get("benefit", ""))
        total_monthly += amt or 0
        if cat.get("is_cash") or amt:
            cash_count += 1

    # 카테고리 분류 (sample_data의 category 필드 사용)
    categories = list({
        policy_benefit_map.get(p.get("id", ""), "")
        for p in eligible if p.get("id")
    } - {""})
    # 카테고리가 없으면 정책명 첫 단어로 폴백
    if not categories:
        categories = list({p.get("name", "").split()[0] for p in eligible if p.get("name")})

    # sample_data에서 category 필드 가져오기
    try:
        category_map = {p["id"]: p.get("category", "") for p in WELFARE_POLICIES}
        categories = list({category_map.get(p.get("id", ""), "") for p in eligible} - {""})
    except Exception:
        pass

    portfolio = {
        "total_eligible": len(eligible),
        "high_priority_count": len(high),
        "medium_priority_count": len(medium),
        "low_priority_count": len(low),
        "total_benefit_amount": total_monthly,
        "cash_benefit_count": cash_count,
        "estimated_monthly_krw": total_monthly,
        "estimated_annual_krw": total_monthly * 12,
        "categories": categories,
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
