"""Node 3: eligibility_check — GPT-4o 기반 자격 판별 (Mock 폴백 포함)"""
import json
from ..state import AgentState, NodeEvent
from ..mock_responses import is_mock_mode, mock_eligibility

_SYSTEM_PROMPT = """당신은 한국 복지 정책 자격 판별 전문가입니다.
사용자 프로필과 복지 정책 목록을 분석하여 각 정책의 수혜 자격 여부를 판단하세요.

Few-shot 예시:
[정책: 기초연금 / 사용자: 70세, 기준중위소득 40%]
→ 자격있음. 이유: 만 65세 이상이며 소득기준(하위 70%) 충족.

[정책: 청년 내일저축계좌 / 사용자: 45세, 취업]
→ 자격없음. 이유: 만 19~34세 연령 기준 미충족.

JSON 형식으로만 응답:
{
  "eligible_policies": [
    {
      "id": "정책ID",
      "name": "정책명",
      "eligible": true,
      "confidence": 0.95,
      "reason": "자격 판별 근거 (구체적으로)",
      "priority": "high|medium|low"
    }
  ],
  "reasoning_summary": "전체 판별 요약"
}"""


async def eligibility_check_node(state: AgentState) -> dict:
    label = "GPT-4o 자격 판별 중..." if not is_mock_mode() else "자격 판별 중 (Mock 모드)..."
    new_events = [NodeEvent(node="eligibility_check", status="running", message=label)]

    profile = state.user_profile
    policies = state.retrieved_policies

    if not policies:
        new_events.append(NodeEvent(node="eligibility_check", status="done", message="검색된 정책 없음"))
        return {"events": new_events, "eligible_policies": [], "eligibility_reasoning": "검색 결과 없음"}

    if is_mock_mode():
        result = mock_eligibility(policies, profile)
    else:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage

        profile_text = (
            f"나이: {profile.age}세, 성별: {profile.gender}, 지역: {profile.region}\n"
            f"가구유형: {profile.household_type}, 소득수준: 중위소득 {profile.income_percentile}%\n"
            f"장애: {'있음 (' + profile.disability_grade + ')' if profile.disability else '없음'}\n"
            f"고용상태: {profile.employment_status}\n"
            f"자녀: {profile.children_ages if profile.has_children else '없음'}, 임신: {profile.is_pregnant}\n"
            f"생애이벤트: {', '.join(profile.life_events) if profile.life_events else '없음'}"
        )
        policies_text = json.dumps(
            [{"id": p["id"], "name": p["name"], "document": p["document"]} for p in policies],
            ensure_ascii=False, indent=2,
        )

        llm = ChatOpenAI(model="gpt-4o", temperature=0, response_format={"type": "json_object"})
        response = await llm.ainvoke([
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=f"사용자 프로필:\n{profile_text}\n\n정책 목록:\n{policies_text}"),
        ])
        result = json.loads(response.content)

    eligible = [p for p in result.get("eligible_policies", []) if p.get("eligible")]
    new_events.append(NodeEvent(
        node="eligibility_check",
        status="done",
        message=f"자격 있는 정책 {len(eligible)}건 판별 완료",
        data={"eligible_count": len(eligible), "policies": [p["name"] for p in eligible]},
    ))

    return {
        "events": new_events,
        "eligible_policies": result.get("eligible_policies", []),
        "eligibility_reasoning": result.get("reasoning_summary", ""),
    }
