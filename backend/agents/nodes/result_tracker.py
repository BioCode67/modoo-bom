"""Node 9: result_tracker — 사후관리(추적) 안내 생성

⚠️ 이 노드는 '신청 결과'를 지어내지 않는다.
분석 시점에는 아직 신청 전이므로, 실제 심사 상태는 알 수 없다.
대신 각 추천 정책에 대해 '신청 후 어떻게 추적·점검하면 되는지'를
정책 데이터(처리기관·갱신주기) 기반으로 정직하게 안내한다.

실제 진행상황 추적은 사용자가 신청한 뒤,
프론트엔드 '나의 복지(사후관리)'에서 신청일·점검일을 기록하며 관리한다.
"""
from ..state import AgentState, NodeEvent
from rag.sample_data import WELFARE_POLICIES

_POLICY_MAP = {p["id"]: p for p in WELFARE_POLICIES}

# 처리 기간/상태조회 채널 추정 (기관 기반, 보수적 안내)
def _processing_estimate(application: str, department: str) -> str:
    a = (application or "") + (department or "")
    if "고용" in a:
        return "신청 후 약 2주 내 수급자격 인정 (고용센터)"
    if "건강보험" in a or "건보" in a:
        return "자격 확인은 즉시~수일 내"
    return "신청 후 약 2~4주 내 결과 통보(소득·재산 조사 포함)"


def _status_channel(application: str, department: str) -> str:
    a = (application or "") + (department or "")
    if "고용" in a:
        return "고용24(work24.go.kr) 또는 고용센터 1350"
    if "건강보험" in a or "건보" in a:
        return "건강보험공단 1577-1000"
    if "주택" in a or "LH" in a:
        return "마이홈포털(myhome.go.kr) 1600-1004"
    return "복지로(bokjiro.go.kr) 신청내역 조회 또는 129"


async def result_tracker_node(state: AgentState) -> dict:
    new_events = [NodeEvent(node="result_tracker", status="running", message="사후관리(추적) 계획 수립 중...")]

    eligible = [p for p in state.eligible_policies if p.get("eligible")]
    plans = []

    for policy in eligible[:5]:
        full = _POLICY_MAP.get(policy.get("id", ""), {})
        application = full.get("application", "")
        department = full.get("department", "")
        plans.append({
            "policy_id": policy.get("id"),
            "policy_name": policy.get("name"),
            # 실제 상태가 아님을 명확히: 아직 신청 전 단계
            "application_status": "신청 전 — 신청 후 추적 예정",
            "expected_processing": _processing_estimate(application, department),
            "status_check": _status_channel(application, department),
            "renewal": full.get("renewal", "기관 안내 확인"),
            "guidance": "신청 후 '나의 복지'에서 신청일을 기록하면 진행 점검·갱신 시기를 자동으로 챙겨드립니다.",
        })

    new_events.append(NodeEvent(
        node="result_tracker",
        status="done",
        message=f"사후관리 안내 {len(plans)}건 준비 (실시간 심사상태는 신청 후 공식 채널에서 확인)",
        data={"tracked": plans},
    ))

    return {"events": new_events, "tracked_applications": plans}
