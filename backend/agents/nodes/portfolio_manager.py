"""Node 7: portfolio_manager — 복지 포트폴리오 요약"""
import re
from ..state import AgentState, NodeEvent


def _is_cash_benefit(benefit_text: str, context: str = "") -> bool:
    """현금성(매월 현금처럼 받는 지원) 여부 — 프론트 format.ts isCashBenefit과 동일 원칙(패리티).
    바우처·이용권·대출·현물·서비스한도액·감면·장려금은 제외해 합계 과장을 막는다.
    단 '현금 지급'이 명시되면(예: 부모급여의 조건부 바우처 설명) 현금성으로 본다."""
    t = f"{benefit_text} {context}"
    explicit_cash = re.search(r"현금\s*지급|현금으로|차액\s*현금", t) is not None
    if not explicit_cash and re.search(r"바우처|이용권|대출|상당|본인부담|전액\s*지원|현물", t):
        return False
    if re.search(r"대출|본인부담|전액\s*지원", t):
        return False
    if re.search(r"장기요양|재가급여|시설급여|요양급여|활동지원|돌봄|간병|감면|장려금|치료관리|치료비", t):
        return False
    return True


def _estimate_monthly_benefit(policy_name: str, benefit_text: str) -> int:
    """benefit 텍스트에서 월 금액 추출 (원 단위). 없으면 0."""
    # "월 최대 N원" / "월 N만원" 패턴
    compact = benefit_text.replace(" ", "")  # 정규식·'만' 근접 판정을 '같은 문자열'에서 수행(위치 불일치 방지)
    patterns = [
        r"월\s*최대?\s*([\d,]+)원",
        r"월\s*([\d,]+)만?\s*원",
        r"([\d,]+)원\s*지급",
    ]
    for pat in patterns:
        m = re.search(pat, compact)
        if m:
            raw = m.group(1).replace(",", "")
            if not raw:  # 정규식이 콤마만 매칭한 경우(예: "월 ,원") — int("") ValueError 방지
                continue
            val = int(raw)
            # "만원" 단위 처리 — 매칭된 '숫자 바로 뒤'에 '만'이 붙는지로 판정한다.
            #   ⚠️ 과거엔 콤마 제거 전 원문에서 find(raw)로 위치를 찾아, 콤마 있는 수('100,000')는
            #   find→-1→슬라이스가 문장 앞부분을 읽어 '만 8세…' 같은 무관한 '만'을 오검출(1만배 과대). 감사 실결함.
            if "만" in compact[m.start(1):m.end(1) + 3]:
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
        benefit_text = policy_benefit_map.get(pid, "") or cat.get("benefit", "")
        # 카탈로그에 파생된 실제 금액이 있으면 우선, 없으면 시드 benefit 텍스트에서 추출
        amt = cat.get("amount_krw") or _estimate_monthly_benefit(p.get("name", ""), benefit_text)
        # 정직한 합산: 현금성만(프론트와 동일 원칙) — 바우처·대출·납입형이 섞이면 비현실 합계가 된다
        is_cash = bool(cat.get("is_cash")) or _is_cash_benefit(benefit_text, p.get("name", ""))
        if is_cash and amt:
            total_monthly += amt
            cash_count += 1

    # 카테고리 분류 (sample_data의 category 필드 사용)
    categories = list({
        policy_benefit_map.get(p.get("id", ""), "")
        for p in eligible if p.get("id")
    } - {""})
    # 카테고리가 없으면 정책명 첫 단어로 폴백 (.strip()로 공백만 있는 이름 제외 → split()[0] IndexError 방지)
    if not categories:
        categories = list({p["name"].split()[0] for p in eligible if p.get("name", "").strip()})

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
