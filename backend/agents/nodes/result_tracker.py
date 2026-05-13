"""Node 9: result_tracker — 신청 결과 추적 (Mock)"""
import random
from datetime import datetime, timedelta
from ..state import AgentState, NodeEvent

_MOCK_STATUSES = ["신청 완료", "검토 중", "추가 서류 요청", "승인", "거절"]


async def result_tracker_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="result_tracker", status="running", message="신청 이력 추적 중...")]

    eligible = [p for p in state.eligible_policies if p.get("eligible")]
    tracked = []

    today = datetime.now()
    for policy in eligible[:3]:
        status = random.choice(_MOCK_STATUSES)
        applied_days_ago = random.randint(3, 30)
        applied_at = (today - timedelta(days=applied_days_ago)).strftime("%Y-%m-%d")
        last_updated = (today - timedelta(days=random.randint(0, applied_days_ago - 1))).strftime("%Y-%m-%d")
        entry: dict = {
            "policy_id": policy.get("id"),
            "policy_name": policy.get("name"),
            "application_status": status,
            "applied_at": applied_at,
            "last_updated": last_updated,
        }
        if status == "거절":
            entry["rejection_reason"] = "소득 기준 초과 (경계 사례)"
            entry["alternative"] = "차상위 본인부담경감 의료비 지원 등 대체 혜택 검토 권장"
        elif status == "추가 서류 요청":
            entry["required_additional_docs"] = ["소득 증빙 서류 추가", "거주 확인서"]
        tracked.append(entry)

    new_events.append(NodeEvent(
        node="result_tracker",
        status="done",
        message=f"추적 중인 신청 {len(tracked)}건",
        data={"tracked": tracked},
    ))

    return {"events": new_events, "tracked_applications": tracked}
