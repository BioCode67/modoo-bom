"""Node 4: reflection_check — Hallucination 검증 (Mock 폴백 포함)"""
import json
from agents.utils import extract_json, safe_json_dumps
from ..state import AgentState, NodeEvent
from ..mock_responses import is_mock_mode, mock_reflection
from ..llm import get_chat_llm

MAX_RETRIES = 2

_SYSTEM_PROMPT = """당신은 복지 정책 자격 판별 결과를 검증하는 QA 전문가입니다.
1. 연령 요건이 프로필과 일치하는가?
2. 소득 요건이 프로필과 일치하는가?
3. 장애/임신/고용상태 등 특수 조건이 정확히 반영되었는가?
4. 할루시네이션(사실과 다른 근거)이 없는가?

JSON으로만 응답:
{
  "passed": true,
  "issues": [],
  "summary": "검증 요약"
}"""


async def reflection_check_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="reflection_check", status="running", message="자격 판별 결과 검증 중...")]

    if state.retry_count >= MAX_RETRIES:
        new_events.append(NodeEvent(
            node="reflection_check", status="done",
            message="최대 재시도 도달 — 현재 결과로 진행",
        ))
        return {"events": new_events, "reflection_passed": True, "reflection_issues": []}

    profile = state.user_profile
    eligible = state.eligible_policies

    llm = None if is_mock_mode() else get_chat_llm(temperature=0, max_tokens=1024)
    if llm is None:
        result = mock_reflection(eligible, profile)
    else:
        from langchain_core.messages import SystemMessage, HumanMessage

        profile_text = (
            f"나이: {profile.age}, 소득: 중위소득 {profile.income_percentile}%, "
            f"장애: {profile.disability}, 고용: {profile.employment_status}"
        )
        response = await llm.ainvoke([
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=f"프로필: {profile_text}\n\n판별 결과:\n{safe_json_dumps(eligible, indent=2)}"),
        ])
        result = extract_json(str(response.content))

    passed = result.get("passed", True)
    issues = result.get("issues", [])

    new_events.append(NodeEvent(
        node="reflection_check",
        status="done",
        message="검증 통과" if passed else f"이슈 {len(issues)}건 발견 — 재판별 필요",
        data={"passed": passed, "issues": issues},
    ))

    return {
        "events": new_events,
        "reflection_passed": passed,
        "reflection_issues": issues,
        "retry_count": state.retry_count + (0 if passed else 1),
    }
