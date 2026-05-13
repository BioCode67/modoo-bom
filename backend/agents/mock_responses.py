"""OpenAI API 없이 동작하는 Mock 응답 — 데모/테스트용"""
import json
import os


def is_mock_mode() -> bool:
    key = os.getenv("OPENAI_API_KEY", "")
    return not key or key.startswith("sk-mock") or key == "mock"


# profile_analyzer mock
def mock_profile_analysis(profile) -> dict:
    keywords = []
    if profile.age >= 65:
        keywords += ["기초연금", "노인", "어르신"]
    if profile.age < 35:
        keywords += ["청년", "청년지원"]
    if profile.disability:
        keywords += ["장애인", "장애"]
    if profile.is_pregnant or (profile.has_children and min(profile.children_ages or [99]) < 2):
        keywords += ["임산부", "출산", "영아", "아동수당"]
    if profile.employment_status == "unemployed":
        keywords += ["실업급여", "취업지원", "구직"]
    if profile.income_percentile <= 50:
        keywords += ["저소득", "기초생활"]
    if profile.household_type in ("한부모가족", "조손가구"):
        keywords += ["한부모"]
    keywords = keywords or ["복지", "사회보장"]

    return {
        "summary": (
            f"{profile.name}님({profile.age}세, {profile.region})의 프로필을 분석했습니다. "
            f"가구유형 {profile.household_type}, 소득수준 중위소득 {profile.income_percentile}% 기준으로 "
            f"맞춤 복지 정책을 검색합니다."
        ),
        "keywords": list(dict.fromkeys(keywords))[:8],
    }


# eligibility_check mock
def mock_eligibility(policies: list[dict], profile) -> dict:
    results = []
    for p in policies:
        doc = p.get("document", "")
        name = p.get("name", "")
        pid = p.get("id", "")

        eligible = False
        reason = ""
        priority = "low"
        confidence = 0.5

        # 노인 관련
        if "65세" in doc and profile.age >= 65:
            eligible = True
            reason = f"만 {profile.age}세로 연령 기준 충족"
            priority = "high"
            confidence = 0.95

        # 청년 관련
        elif any(k in doc for k in ["19~34세", "19세~34세", "만 34세"]) and 19 <= profile.age <= 34:
            eligible = True
            reason = f"만 {profile.age}세로 청년 연령 기준 충족"
            priority = "medium"
            confidence = 0.88

        # 장애인
        elif "장애" in doc and profile.disability:
            eligible = True
            reason = f"등록 장애인({profile.disability_grade}) 조건 충족"
            priority = "high"
            confidence = 0.92

        # 아동수당
        elif "만 8세" in doc and profile.has_children and any(a < 8 for a in (profile.children_ages or [])):
            eligible = True
            reason = "만 8세 미만 자녀 보유"
            priority = "high"
            confidence = 0.97

        # 임산부
        elif "임산부" in doc and profile.is_pregnant:
            eligible = True
            reason = "임신 중 확인"
            priority = "high"
            confidence = 0.96

        # 저소득
        elif "중위소득 50%" in doc and profile.income_percentile <= 50:
            eligible = True
            reason = f"소득 기준 중위소득 {profile.income_percentile}%로 기준 충족"
            priority = "medium"
            confidence = 0.85

        # 실업급여
        elif "실직" in doc or "이직" in doc:
            if profile.employment_status == "unemployed":
                eligible = True
                reason = "실직/비자발적 이직으로 신청 자격 있음"
                priority = "high"
                confidence = 0.80

        # 한부모
        elif "한부모" in doc and profile.household_type == "한부모가족":
            eligible = True
            reason = "한부모가족 확인"
            priority = "high"
            confidence = 0.93

        # 기초생활
        elif any(k in doc for k in ["기초생활", "중위소득 30%"]) and profile.income_percentile <= 30:
            eligible = True
            reason = f"소득 중위소득 {profile.income_percentile}%로 기초생활 기준 충족 가능"
            priority = "high"
            confidence = 0.78

        results.append({
            "id": pid,
            "name": name,
            "eligible": eligible,
            "confidence": confidence,
            "reason": reason if eligible else "현재 프로필 기준 자격 조건 미충족",
            "priority": priority if eligible else "low",
        })

    eligible_names = [r["name"] for r in results if r["eligible"]]
    return {
        "eligible_policies": results,
        "reasoning_summary": (
            f"총 {len(policies)}개 정책 검토 결과 {len(eligible_names)}개 수혜 자격 확인: "
            + (", ".join(eligible_names[:3]) + ("..." if len(eligible_names) > 3 else ""))
            if eligible_names else "현재 프로필 기준 수혜 가능 정책을 찾지 못했습니다."
        ),
    }


# reflection_check mock
def mock_reflection(eligible: list[dict], profile) -> dict:
    issues = []
    for p in eligible:
        if not p.get("eligible"):
            continue
        # 간단한 규칙 검증
        if "노인" in p.get("name", "") and profile.age < 65:
            issues.append(f"{p['name']}: 연령 기준 불일치")
        if "청년" in p.get("name", "") and profile.age > 34:
            issues.append(f"{p['name']}: 청년 연령 초과")

    return {
        "passed": len(issues) == 0,
        "issues": issues,
        "summary": "검증 완료" if not issues else f"{len(issues)}건 이슈 발견",
    }


# guide_generator mock
def mock_guides(policies: list[dict]) -> dict:
    guides = []
    for p in policies[:5]:
        if not p.get("eligible"):
            continue
        name = p.get("name", "")
        pid = p.get("id", "")
        guides.append({
            "policy_id": pid,
            "policy_name": name,
            "plain_description": f"{name}은 자격 조건을 갖춘 분께 지원되는 복지 혜택입니다.",
            "steps": [
                "주민센터 방문 또는 복지로(www.bokjiro.go.kr) 온라인 신청",
                "필요 서류 제출 (주민등록등본 등)",
                "담당자 확인 후 수급 자격 판정",
                "결정 통보 수령 (2~4주 소요)",
                "급여 지급 시작",
            ],
            "tips": "신청 전 주민센터에 전화(☎ 129)로 서류를 미리 확인하면 편리합니다.",
            "estimated_days": 14,
        })
    return {"guides": guides}


# orchestrator mock
def mock_final_response(eligible: list[dict], docs: list[dict], notifications: list[dict]) -> str:
    eligible_list = [p for p in eligible if p.get("eligible")]
    doc_ok = [d for d in docs if d.get("success")]

    lines = [
        f"## 복지 분석 결과 요약\n",
        f"**수혜 가능 정책 {len(eligible_list)}건**을 찾았습니다.\n",
    ]

    if eligible_list:
        lines.append("### 우선 신청 추천")
        for p in sorted(eligible_list, key=lambda x: x.get("confidence", 0), reverse=True)[:3]:
            lines.append(f"- **{p['name']}**: {p['reason']}")

    if doc_ok:
        lines.append(f"\n### 자동 취득 서류 ({len(doc_ok)}건)")
        for d in doc_ok:
            lines.append(f"- {d['doc_name']} (접수번호: {d.get('receipt_number', 'N/A')})")

    if notifications:
        lines.append("\n### 생애이벤트 알림")
        for n in notifications[:2]:
            lines.append(f"- {n['title']}")

    lines.append("\n> 복지로(www.bokjiro.go.kr) 또는 주민센터에서 신청하실 수 있습니다.")
    return "\n".join(lines)
