"""Node 2: policy_search — ChromaDB RAG 기반 복지 정책 검색 (Mock 폴백 포함)"""
from ..state import AgentState, NodeEvent
from ..mock_responses import is_mock_mode


def _mock_search(profile) -> list[dict]:
    from rag.sample_data import WELFARE_POLICIES

    scored = []
    for p in WELFARE_POLICIES:
        doc = p.get("target", "") + p.get("eligibility", "") + p.get("category", "")
        score = 0

        if profile.age >= 65 and any(k in doc for k in ["65세", "노인"]):            score += 3
        if 19 <= profile.age <= 34 and any(k in doc for k in ["청년", "34세"]):    score += 3
        if profile.disability and "장애" in doc:                                     score += 3
        if profile.is_pregnant and any(k in doc for k in ["임산부", "임신", "출산"]): score += 3
        if profile.has_children and any(a < 8 for a in (profile.children_ages or [])) \
                and any(k in doc for k in ["아동", "영유아", "영아"]):               score += 2
        if profile.employment_status == "unemployed" \
                and any(k in doc for k in ["실직", "구직", "실업"]):                score += 2
        if profile.income_percentile <= 30 \
                and any(k in doc for k in ["기초생활", "중위소득 30%"]):             score += 2
        if profile.income_percentile <= 50 \
                and any(k in doc for k in ["중위소득 50%", "차상위"]):              score += 1
        if profile.household_type == "한부모가족" and "한부모" in doc:              score += 3

        if score > 0:
            scored.append((score, p))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = [p for _, p in scored[:10]]

    if len(top) < 5:
        extra = [p for p in WELFARE_POLICIES if p not in top]
        top.extend(extra[:5 - len(top)])

    result = []
    for i, p in enumerate(top):
        doc_text = (
            f"정책명: {p['name']}\n카테고리: {p['category']}\n대상: {p['target']}\n"
            f"혜택: {p['benefit']}\n자격요건: {p['eligibility']}\n"
            f"필요서류: {', '.join(p['required_docs'])}\n신청방법: {p['application']}\n"
            f"담당부처: {p['department']}"
        )
        result.append({
            "id": p["id"], "name": p["name"], "category": p["category"],
            "target": p["target"], "department": p["department"], "renewal": p["renewal"],
            "required_docs": p["required_docs"], "document": doc_text,
            "similarity_score": round(1.0 - i * 0.05, 4),
        })
    return result


async def policy_search_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="policy_search", status="running", message="복지 정책 검색 중...")]

    profile = state.user_profile

    if is_mock_mode():
        retrieved = _mock_search(profile)
    else:
        try:
            from rag.embedder import search_policies

            query_parts = list(state.search_keywords) + [
                profile.household_type, f"나이 {profile.age}세", profile.employment_status,
            ]
            if profile.disability:       query_parts.append("장애인")
            if profile.is_pregnant:      query_parts.append("임산부 출산")
            if profile.has_children:     query_parts.append(f"자녀 아동 {profile.children_ages}")

            query = " ".join(q for q in query_parts if q)
            retrieved = search_policies(query, n_results=10)
        except Exception:
            retrieved = _mock_search(profile)

    new_events.append(NodeEvent(
        node="policy_search",
        status="done",
        message=f"유사 정책 {len(retrieved)}건 검색 완료",
        data={"count": len(retrieved), "policies": [p["name"] for p in retrieved]},
    ))

    return {"events": new_events, "retrieved_policies": retrieved}
