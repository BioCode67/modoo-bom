"""Node 5: guide_generator — 신청 가이드 생성 (Mock 폴백 포함)"""
import json
from agents.utils import extract_json, safe_json_dumps
from ..state import AgentState, NodeEvent
from ..mock_responses import is_mock_mode, mock_guides
from ..llm import get_chat_llm

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

    llm = None if is_mock_mode() else get_chat_llm(temperature=0.3, max_tokens=2048)
    if llm is None:
        result = mock_guides(eligible)
    else:
        try:
            from langchain_core.messages import SystemMessage, HumanMessage
            from rag.sample_data import WELFARE_POLICIES

            policy_map = {p["id"]: p for p in WELFARE_POLICIES}
            top = sorted(eligible, key=lambda x: x.get("confidence", 0), reverse=True)[:5]
            enriched = [{**ep, **policy_map.get(ep.get("id", ""), {})} for ep in top]

            response = await llm.ainvoke([
                SystemMessage(content=_SYSTEM_PROMPT),
                HumanMessage(content=f"정책 목록:\n{safe_json_dumps(enriched, indent=2)}"),
            ])
            result = extract_json(str(response.content))
        except Exception as e:
            print(f"[guide_generator] LLM 실패 → 규칙 폴백: {e}")
            result = mock_guides(eligible)

    # LLM이 스키마를 어겨 guides를 문자열 리스트/None/비-리스트로 줘도 분석 전체가 죽지 않게 방어
    #   (이 루프는 try/except 밖이라 g.get AttributeError가 astream을 중단시키던 잠재 결함 — 감사).
    guides = result.get("guides") or []
    if not isinstance(guides, list):
        guides = []

    from rag.sample_data import WELFARE_POLICIES
    policy_map = {p["id"]: p for p in WELFARE_POLICIES}
    all_docs: list[str] = []
    for g in guides:
        if not isinstance(g, dict):
            continue  # 문자열 등 비-dict 항목은 건너뛴다(g.get 크래시 방지)
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
