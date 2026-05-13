"""Node 5: guide_generator — 신청 가이드 생성 (Mock 폴백 포함)"""
import json
from agents.utils import extract_json
from ..state import AgentState, NodeEvent
from ..mock_responses import is_mock_mode, mock_guides

_SYSTEM_PROMPT = """당신은 복지 신청 도우미입니다. 쉬운 언어로 단계별 신청 가이드를 작성하세요.
JSON으로만 응답:
{
  "guides": [
    {
      "policy_id": "POL-001",
      "policy_name": "기초연금",
      "plain_description": "쉬운말 설명",
      "steps": ["1단계: ...", "2단계: ..."],
      "tips": "신청 팁",
      "estimated_days": 14
    }
  ]
}"""


async def guide_generator_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="guide_generator", status="running", message="신청 가이드 생성 중...")]

    eligible = [p for p in state.eligible_policies if p.get("eligible")]
    if not eligible:
        new_events.append(NodeEvent(node="guide_generator", status="done", message="자격 있는 정책 없음"))
        return {"events": new_events, "application_guides": [], "required_docs": []}

    if is_mock_mode():
        result = mock_guides(eligible)
    else:
        from langchain_anthropic import ChatAnthropic
        from langchain_core.messages import SystemMessage, HumanMessage
        from rag.sample_data import WELFARE_POLICIES
        import os

        policy_map = {p["id"]: p for p in WELFARE_POLICIES}
        top = sorted(eligible, key=lambda x: x.get("confidence", 0), reverse=True)[:5]
        enriched = [{**ep, **policy_map.get(ep.get("id", ""), {})} for ep in top]

        model = os.getenv("CLAUDE_MODEL", "claude-opus-4-7")
        llm = ChatAnthropic(model=model, temperature=0.3, max_tokens=2048)
        response = await llm.ainvoke([
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=f"정책 목록:\n{json.dumps(enriched, ensure_ascii=False, indent=2)}"),
        ])
        result = extract_json(str(response.content))

    guides = result.get("guides", [])

    from rag.sample_data import WELFARE_POLICIES
    policy_map = {p["id"]: p for p in WELFARE_POLICIES}
    all_docs: list[str] = []
    for g in guides:
        pid = g.get("policy_id")
        if pid in policy_map:
            all_docs.extend(policy_map[pid].get("required_docs", []))
    required_docs = list(dict.fromkeys(all_docs))

    new_events.append(NodeEvent(
        node="guide_generator",
        status="done",
        message=f"가이드 {len(guides)}건 생성 완료",
        data={"guide_count": len(guides), "required_docs": required_docs},
    ))

    return {
        "events": new_events,
        "application_guides": guides,
        "required_docs": required_docs,
    }
