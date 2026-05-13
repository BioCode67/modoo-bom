"""Node 3: eligibility_check — Claude 기반 자격 판별 (Mock 폴백 포함)"""
import json
from agents.utils import extract_json, safe_json_dumps, sanitize_text
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
    label = "Claude 자격 판별 중..." if not is_mock_mode() else "자격 판별 중 (Mock 모드)..."
    new_events = [NodeEvent(node="eligibility_check", status="running", message=label)]

    profile = state.user_profile
    policies = state.retrieved_policies

    if not policies:
        new_events.append(NodeEvent(node="eligibility_check", status="done", message="검색된 정책 없음"))
        return {"events": new_events, "eligible_policies": [], "eligibility_reasoning": "검색 결과 없음"}

    if is_mock_mode():
        result = mock_eligibility(policies, profile)
    else:
        from langchain_anthropic import ChatAnthropic
        from langchain_core.messages import SystemMessage, HumanMessage
        import os

        profile_text = sanitize_text(
            f"나이: {profile.age}세, 성별: {profile.gender}, 지역: {profile.region}\n"
            f"가구유형: {profile.household_type}, 소득수준: 중위소득 {profile.income_percentile}%\n"
            f"장애: {'있음 (' + profile.disability_grade + ')' if profile.disability else '없음'}\n"
            f"고용상태: {profile.employment_status}\n"
            f"자녀: {profile.children_ages if profile.has_children else '없음'}, 임신: {profile.is_pregnant}\n"
            f"생애이벤트: {', '.join(profile.life_events) if profile.life_events else '없음'}"
        )
        policies_text = safe_json_dumps(
            [{"id": p["id"], "name": p["name"], "document": p["document"]} for p in policies],
            indent=2,
        )

        model = os.getenv("CLAUDE_MODEL", "claude-opus-4-7")
        llm = ChatAnthropic(model=model, temperature=0, max_tokens=2048)
        response = await llm.ainvoke([
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=f"사용자 프로필:\n{profile_text}\n\n정책 목록:\n{policies_text}"),
        ])
        result = extract_json(str(response.content))

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
