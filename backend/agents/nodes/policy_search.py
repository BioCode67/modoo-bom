"""Node 2: policy_search — ChromaDB RAG 기반 복지 정책 검색 (Mock 폴백 포함)"""
from ..state import AgentState, NodeEvent
from ..mock_responses import is_mock_mode


def _mock_search(profile) -> list[dict]:
    from rag.sample_data import WELFARE_POLICIES

    scored = []
    for p in WELFARE_POLICIES:
        # ⚠️ 이름도 검색 대상에 포함 — '기초생활'이 target/eligibility가 아니라 '이름'에만 있는 생계·주거·의료급여가
        #   score 0으로 밀려 저소득자에게 아예 검색조차 안 되던 것 방지(감사 #3).
        doc = p.get("name", "") + p.get("target", "") + p.get("eligibility", "") + p.get("category", "")
        score = 0

        if profile.age >= 65 and any(k in doc for k in ["65세", "노인"]):            score += 3
        if 19 <= profile.age <= 34 and any(k in doc for k in ["청년", "34세"]):    score += 3
        if profile.disability and "장애" in doc:                                     score += 3
        if profile.is_pregnant and any(k in doc for k in ["임산부", "임신", "출산"]): score += 3
        # 자녀양육 점수를 청년(+3)과 동률로 — 어린 자녀를 둔 '젊은 부모'가 청년 정책에 밀려 아동수당·부모급여가
        #   top에서 통째로 탈락하던 것 방지(감사 #2). 매칭어도 부모급여·아동수당·육아까지 확장.
        if profile.has_children and any(a < 8 for a in (profile.children_ages or [])) \
                and any(k in doc for k in ["아동", "영유아", "영아", "부모급여", "아동수당", "육아", "보육", "양육"]): score += 3
        if profile.employment_status == "unemployed" \
                and any(k in doc for k in ["실직", "구직", "실업"]):                score += 2
        # 저소득: 기초생활보장 급여명(생계/주거/의료/교육)·차상위·저소득까지 포괄(선정기준 32/48% 표기차와 무관하게
        #   검색에는 걸리게 — 정밀 소득 게이트는 eligibility_check가 담당). income<=50으로 넓게 후보에 올린다.
        if profile.income_percentile <= 50 \
                and any(k in doc for k in ["기초생활", "생계급여", "주거급여", "의료급여", "교육급여", "차상위", "저소득", "기초수급", "수급자"]): score += 2
        if profile.household_type == "한부모가족" and "한부모" in doc:              score += 3

        if score > 0:
            scored.append((score, p))

    # 동점은 원본 순서 유지(안정 정렬). 상한을 10→16으로 — 다범주 프로필(청년+자녀·노인+저소득 등)이
    #   상위에서 밀려 한 범주가 통째로 누락되던 것 완화(감사 #2). 정밀 자격판정은 뒤 노드가 수행.
    scored.sort(key=lambda x: x[0], reverse=True)
    top = [p for _, p in scored[:16]]

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
            from rag.search import search_policies

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
