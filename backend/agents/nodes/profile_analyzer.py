"""Node 1: profile_analyzer — 사용자 프로필 분석 및 검색 키워드 추출 (Claude)"""
import json
from agents.utils import extract_json, sanitize_text
from ..state import AgentState, NodeEvent
from ..mock_responses import is_mock_mode, mock_profile_analysis

_SYSTEM_PROMPT = """당신은 복지 정책 전문가입니다.
사용자 프로필을 분석하여 적합한 복지 정책 검색을 위한 한국어 키워드를 추출하세요.
JSON 형식으로만 응답하세요:
{
  "summary": "프로필 요약 (2-3문장)",
  "keywords": ["키워드1", "키워드2", ...최대 8개]
}"""


async def profile_analyzer_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="profile_analyzer", status="running", message="프로필 분석 중...")]

    profile = state.user_profile

    if is_mock_mode():
        result = mock_profile_analysis(profile)
    else:
        from langchain_anthropic import ChatAnthropic
        from langchain_core.messages import SystemMessage, HumanMessage
        import os

        profile_text = sanitize_text(
            f"이름: {profile.name}, 나이: {profile.age}세, 성별: {profile.gender}\n"
            f"거주지역: {profile.region}, 가구유형: {profile.household_type}\n"
            f"소득수준: 기준중위소득 {profile.income_percentile}%\n"
            f"장애여부: {'있음 (' + profile.disability_grade + ')' if profile.disability else '없음'}\n"
            f"고용상태: {profile.employment_status}\n"
            f"자녀: {'있음 (나이: ' + str(profile.children_ages) + ')' if profile.has_children else '없음'}\n"
            f"임신여부: {profile.is_pregnant}\n"
            f"최근 생애이벤트: {', '.join(profile.life_events) if profile.life_events else '없음'}"
        )

        model = os.getenv("CLAUDE_MODEL", "claude-opus-4-7")
        llm = ChatAnthropic(model=model, temperature=0, max_tokens=1024)
        response = await llm.ainvoke([
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=f"사용자 프로필:\n{profile_text}"),
        ])
        result = extract_json(str(response.content))

    keywords = result.get("keywords", [])
    new_events.append(NodeEvent(
        node="profile_analyzer",
        status="done",
        message=f"검색 키워드 {len(keywords)}개 추출 완료",
        data={"keywords": keywords},
    ))

    return {
        "events": new_events,       # operator.add → 자동 append
        "profile_summary": result.get("summary", ""),
        "search_keywords": keywords,
    }
