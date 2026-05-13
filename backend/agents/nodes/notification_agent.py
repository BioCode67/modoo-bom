"""Node 8: notification_agent — 생애 이벤트 기반 Push 알림"""
from ..state import AgentState, NodeEvent

_TRIGGERS: dict[str, list[str]] = {
    "실직":   ["실업급여 (구직급여)", "국민취업지원제도 I 유형", "청년 구직활동 지원금"],
    "출산":   ["영아수당(부모급여)", "아동수당", "임신·출산 진료비 지원 (국민행복카드)", "저소득층 기저귀·조제분유 지원"],
    "만65세": ["기초연금", "노인 장기요양서비스", "노인 일자리 및 사회활동 지원", "노인 맞춤돌봄서비스"],
    "임신":   ["임신·출산 진료비 지원 (국민행복카드)", "청소년 산모 임신·출산 의료비 지원"],
    "취업":   ["청년 내일저축계좌", "청년 도약계좌"],
    "장애진단": ["장애인연금", "장애인 활동지원서비스", "장애인 편의시설 설치 지원"],
}


async def notification_agent_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="notification_agent", status="running", message="생애 이벤트 알림 분석 중...")]

    notifications: list[dict] = []

    for event in state.user_profile.life_events:
        recommended = _TRIGGERS.get(event, [])
        if recommended:
            notifications.append({
                "trigger": event,
                "type": "life_event",
                "title": f"[{event}] 관련 복지 혜택을 확인하세요",
                "recommended_policies": recommended,
                "urgency": "high",
            })

    # 연령 기반 선제 알림
    age = state.user_profile.age
    if 64 <= age < 66:
        notifications.append({
            "trigger": "만65세 도달 예정",
            "type": "age_trigger",
            "title": "곧 만 65세가 되십니다 — 기초연금 신청을 준비하세요",
            "recommended_policies": _TRIGGERS["만65세"],
            "urgency": "medium",
        })

    new_events.append(NodeEvent(
        node="notification_agent",
        status="done",
        message=f"알림 {len(notifications)}건 생성",
        data={"notifications": notifications},
    ))

    return {"events": new_events, "notifications": notifications}
