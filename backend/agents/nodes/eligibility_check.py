"""Node 3: eligibility_check — Claude 기반 자격 판별 (Mock 폴백 포함)"""
import json
from agents.utils import extract_json, safe_json_dumps, sanitize_text
from ..state import AgentState, NodeEvent
from ..mock_responses import is_mock_mode, mock_eligibility
from ..llm import get_chat_llm

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
    label = "AI 자격 판별 중..." if not is_mock_mode() else "자격 판별 중 (규칙기반)..."
    new_events = [NodeEvent(node="eligibility_check", status="running", message=label)]

    profile = state.user_profile
    policies = state.retrieved_policies

    if not policies:
        new_events.append(NodeEvent(node="eligibility_check", status="done", message="검색된 정책 없음"))
        return {"events": new_events, "eligible_policies": [], "eligibility_reasoning": "검색 결과 없음"}

    llm = None if is_mock_mode() else get_chat_llm(temperature=0, max_tokens=2048)
    if llm is None:
        result = mock_eligibility(policies, profile)
    else:
        try:
            from langchain_core.messages import SystemMessage, HumanMessage

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

            response = await llm.ainvoke([
                SystemMessage(content=_SYSTEM_PROMPT),
                HumanMessage(content=f"사용자 프로필:\n{profile_text}\n\n정책 목록:\n{policies_text}"),
            ])
            result = extract_json(str(response.content))
        except Exception as e:
            # LLM 실패(타임아웃·429·JSON파싱 등)해도 전체 분석이 죽지 않게 규칙기반으로 폴백(감사 반영).
            print(f"[eligibility_check] LLM 실패 → 규칙 폴백: {e}")
            result = mock_eligibility(policies, profile)

    # 우선순위(high>med>low) → 신뢰도 정렬 + 이름 중복 제거(프론트 엔진과 일관).
    # RAG 검색 순서로 두면 기초연금(high)이 문화누리카드(medium) 아래로 묻히는 문제 해결.
    _rank = {"high": 3, "medium": 2, "low": 1}
    # eligible 우선(True>False) → 우선순위 → 신뢰도. 동명 항목 중 '자격있음'을 반드시 남긴다
    # (LLM 모드에서 자격없음 사본이 우선순위만 높아 자격있음을 덮어쓰던 경우 방지).
    ordered = sorted(
        result.get("eligible_policies", []),
        key=lambda p: (bool(p.get("eligible")), _rank.get(p.get("priority"), 0), p.get("confidence", 0)),
        reverse=True,
    )
    seen, deduped = set(), []
    for p in ordered:
        key = (p.get("name") or "").replace(" ", "").replace("(", "").replace(")", "")
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(p)

    eligible = [p for p in deduped if p.get("eligible")]
    new_events.append(NodeEvent(
        node="eligibility_check",
        status="done",
        message=f"자격 있는 정책 {len(eligible)}건 판별 완료",
        data={"eligible_count": len(eligible), "policies": [p["name"] for p in eligible]},
    ))

    return {
        "events": new_events,
        "eligible_policies": deduped,
        "eligibility_reasoning": result.get("reasoning_summary", ""),
    }
