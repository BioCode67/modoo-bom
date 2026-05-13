"""Node 8: notification_agent — 생애 이벤트 기반 Push 알림"""
from ..state import AgentState, NodeEvent

_TRIGGERS: dict = {
    "실직":   {
        "policies": ["실업급여 (구직급여)", "국민취업지원제도 I 유형", "청년 구직활동 지원금", "긴급복지지원"],
        "deadline": "실직 후 1년 이내 신청 (실업급여 소멸 시효)",
        "action": "고용센터 방문 또는 고용24(www.work.go.kr) 온라인 신청",
    },
    "출산":   {
        "policies": ["부모급여", "아동수당", "첫만남이용권", "저소득층 기저귀·조제분유 지원"],
        "deadline": "출생 후 60일 이내 아동수당 신청 권장",
        "action": "주민센터 방문 또는 복지로(www.bokjiro.go.kr) 온라인 신청",
    },
    "만65세": {
        "policies": ["기초연금", "노인 장기요양서비스", "노인 일자리 및 사회활동 지원", "노인 맞춤돌봄서비스"],
        "deadline": "만 65세 생일이 속한 달 1개월 전부터 신청 가능",
        "action": "주민센터 방문 또는 복지로 온라인 신청",
    },
    "임신":   {
        "policies": ["임신·출산 진료비 지원 (국민행복카드)", "청소년 산모 임신·출산 의료비 지원"],
        "deadline": "임신 확인 즉시 신청 권장 (국민행복카드 발급)",
        "action": "국민건강보험공단(1577-1000) 또는 보건소 신청",
    },
    "취업":   {
        "policies": ["청년 내일저축계좌", "청년 도약계좌", "내일채움공제"],
        "deadline": "취업 후 3개월 이내 내일저축계좌 신청",
        "action": "복지로 또는 서민금융진흥원(1397) 신청",
    },
    "장애진단": {
        "policies": ["장애인연금", "장애인 활동지원서비스", "장애인 편의시설 설치 지원", "장애수당"],
        "deadline": "장애인 등록 후 즉시 신청 가능",
        "action": "주민센터 방문 또는 복지로 온라인 신청",
    },
    "입학":   {
        "policies": ["초중고 교육급여", "교육비 지원 (교육청)", "학교 무상급식"],
        "deadline": "학기 시작 전 교육급여 신청 (연 2회: 3월, 9월)",
        "action": "주민센터 방문 또는 복지로 온라인 신청",
    },
    "결혼":   {
        "policies": ["신혼부부 전세자금대출", "신혼부부 주거지원"],
        "deadline": "결혼일로부터 7년 이내 신혼부부 특례 적용",
        "action": "한국주택금융공사(1688-8114) 또는 주택도시기금 신청",
    },
}

_AGE_ALERTS = [
    (0,   2,   "medium", "영아 지원", ["영아수당(부모급여)", "아동수당"]),
    (2,   8,   "low",    "아동기 지원", ["아동수당", "보육료 지원"]),
    (19,  35,  "medium", "청년 지원", ["청년 내일저축계좌", "청년 도약계좌", "국민취업지원제도 I 유형"]),
    (64,  66,  "high",   "기초연금 신청 준비", ["기초연금", "노인 맞춤돌봄서비스"]),
    (65,  200, "medium", "노인 복지 서비스", ["노인 장기요양서비스", "노인 일자리 및 사회활동 지원"]),
]


async def notification_agent_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="notification_agent", status="running", message="생애 이벤트 알림 분석 중...")]

    profile = state.user_profile
    notifications: list[dict] = []

    # 생애 이벤트 알림
    for event in profile.life_events:
        trigger_data = _TRIGGERS.get(event, {})
        recommended = trigger_data.get("policies", []) if isinstance(trigger_data, dict) else trigger_data
        if recommended:
            notifications.append({
                "trigger": event,
                "type": "life_event",
                "title": f"[{event}] 관련 복지 혜택을 확인하세요",
                "recommended_policies": recommended,
                "urgency": "high",
                "deadline": trigger_data.get("deadline", "") if isinstance(trigger_data, dict) else "",
                "action": trigger_data.get("action", "") if isinstance(trigger_data, dict) else "",
            })

    # 임신 중 자동 알림
    if profile.is_pregnant:
        notifications.append({
            "trigger": "임신 중",
            "type": "pregnancy",
            "title": "임신 중 — 출산 관련 지원을 미리 준비하세요",
            "recommended_policies": _TRIGGERS["임신"],
            "urgency": "high",
        })

    # 연령 기반 선제 알림
    age = profile.age
    for age_min, age_max, urgency, title, policies in _AGE_ALERTS:
        if age_min <= age < age_max:
            # 이미 같은 정책이 생애이벤트 알림에 포함된 경우 스킵
            already = {p for n in notifications for p in n.get("recommended_policies", [])}
            new_policies = [p for p in policies if p not in already]
            if new_policies:
                notifications.append({
                    "trigger": f"나이 {age}세",
                    "type": "age_trigger",
                    "title": f"{title} — 해당 혜택을 확인하세요",
                    "recommended_policies": new_policies,
                    "urgency": urgency,
                })

    new_events.append(NodeEvent(
        node="notification_agent",
        status="done",
        message=f"알림 {len(notifications)}건 생성",
        data={"notifications": notifications},
    ))

    return {"events": new_events, "notifications": notifications}
