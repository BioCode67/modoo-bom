"""LLM 없이 동작하는 규칙기반 응답 — 데모/테스트/폴백용.

'Mock 모드'는 이제 특정 벤더(Anthropic)가 아니라 '사용 가능한 AI provider가 하나도 없을 때'를
의미한다. Gemini/Groq/Anthropic 중 어느 키라도 있으면 실제 LLM을 쓰고, 없으면 여기 규칙기반으로
전 파이프라인이 동작한다(항상 동작 보장)."""
import os
import re
from rag.sample_data import WELFARE_POLICIES as _ALL_POLICIES
from .llm import active_provider

_POLICY_MAP = {p["id"]: p for p in _ALL_POLICIES}


def is_mock_mode() -> bool:
    """사용 가능한 AI provider가 없으면 True(규칙기반)."""
    return active_provider() is None


# ── profile_analyzer mock ────────────────────────────────────────────────────

def mock_profile_analysis(profile) -> dict:
    keywords = []
    if profile.age >= 65:
        keywords += ["기초연금", "노인", "어르신", "장기요양"]
    elif profile.age >= 60:
        keywords += ["노인", "60세", "고령자"]
    if 19 <= profile.age <= 34:
        keywords += ["청년", "청년지원", "청년취업"]
    if 35 <= profile.age <= 64:
        keywords += ["중장년", "재취업"]
    if profile.disability:
        keywords += ["장애인", "장애", "활동지원"]
    if profile.is_pregnant:
        keywords += ["임산부", "임신", "출산", "국민행복카드"]
    if profile.has_children:
        ages = profile.children_ages or []
        if any(a < 2 for a in ages):
            keywords += ["영아", "부모급여", "아동수당"]
        elif any(a < 9 for a in ages):
            keywords += ["아동수당", "보육료", "유아학비"]
        if any(a < 18 for a in ages):
            keywords += ["아동", "교육급여"]
    if profile.employment_status == "unemployed":
        keywords += ["실업급여", "취업지원", "구직", "국민취업지원제도"]
    # 소득 기반 급여 — 2026 정밀 선정기준(생계32·의료40·주거48·교육/차상위50). 프론트 엔진과 일치.
    if profile.income_percentile <= 50:
        keywords += ["저소득", "교육급여", "차상위"]
        if profile.income_percentile <= 48:
            keywords += ["주거급여"]
        if profile.income_percentile <= 40:
            keywords += ["의료급여"]
        if profile.income_percentile <= 32:
            keywords += ["기초생활", "생계급여"]
    if profile.household_type in ("한부모가족", "조손가구"):
        keywords += ["한부모", "양육비"]
    if profile.household_type == "다문화가족":
        keywords += ["다문화", "방문교육"]
    if "실직" in (profile.life_events or []):
        keywords += ["실업급여", "긴급복지"]
    if "출산" in (profile.life_events or []):
        keywords += ["부모급여", "아동수당", "산모신생아"]
    if "장애진단" in (profile.life_events or []):
        keywords += ["장애인연금", "활동지원", "장애수당"]
    keywords = list(dict.fromkeys(keywords or ["복지", "사회보장"]))[:8]

    region_note = f", {profile.region} 거주" if profile.region else ""
    household_note = f", {profile.household_type} 가구" if profile.household_type else ""

    return {
        "summary": (
            f"{profile.name or '사용자'}님({profile.age}세{region_note}{household_note})의 프로필을 분석했습니다. "
            f"소득수준 기준중위소득 {profile.income_percentile}%로, "
            f"{'장애인 등록 상태이며 ' if profile.disability else ''}"
            f"{'임신 중이며 ' if profile.is_pregnant else ''}"
            f"맞춤 복지 정책 {len(keywords)}개 키워드로 검색합니다."
        ),
        "keywords": keywords,
    }


# ── eligibility_check mock ───────────────────────────────────────────────────

def _income_ceiling(doc: str):
    """소득 상한(기준중위소득 %) 추출 — 프론트 welfare-engine.ts incomeCeiling과 동일 로직(패리티).
    '중위소득 N%'는 그대로, '하위 N%'(백분위)는 ×1.4 근사 환산(기초연금 하위70%≈중위96%, 2026 실측 앵커).
    여러 값이면 가장 관대한(높은) 상한. 숫자 없는 '저소득'만으로는 게이트하지 않음."""
    # '부모 소득 중위 100%'·'부양의무자 … N%'는 신청자 본인(income_percentile)이 아니라 다른 사람의 소득요건 →
    #   MAX 상한 계산에 넣으면 본인 상한(청년월세 60%)을 부모 상한(100%)이 덮어 고소득자가 통과된다(감사 HIGH,
    #   프론트 incomeCeiling과 동일 패리티 수정). '가구 중위소득'=본인가구는 유지, 부모·부양의무자 절만 제거.
    applicant_doc = re.sub(r"부모[^,，、;.]*?[0-9]{2,3}\s*%\s*(?:이하|미만)?", " ", doc)
    applicant_doc = re.sub(r"부양의무자[^,，、;.]*?[0-9]{2,3}\s*%\s*(?:이하|미만)?", " ", applicant_doc)
    ceil = None
    for m in re.finditer(r"중위(?:소득)?\s*([0-9]{2,3})\s*%", applicant_doc):
        v = int(m.group(1))
        if ceil is None or v > ceil:
            ceil = v
    for m in re.finditer(r"하위\s*([0-9]{2,3})\s*%", applicant_doc):
        v = round(int(m.group(1)) * 1.4 / 5) * 5
        if ceil is None or v > ceil:
            ceil = v
    if ceil is None and "차상위" in doc:
        ceil = 50
    # %가 안 적힌 자산심사형(수급 가구/수급자/급여 수급)도 저소득 상한(중위 50% 근사)으로 본다.
    # 단, '미수급자'(부정어)·'수급자 우선'(우대)은 소득상한이 아니므로 제거 후 판정(프론트 incomeCeiling과 패리티).
    if ceil is None:
        doc_low = re.sub(r"미수급[가-힣]*", "", doc)
        doc_low = re.sub(r"수급자?\s*우선", "", doc_low)
        if any(k in doc_low for k in ["기초생활", "생계급여", "기초생활수급", "기초수급", "수급자", "수급 가구", "급여 수급"]):
            ceil = 50
    return ceil


def _check_policy(doc: str, name: str, pid: str, profile) -> tuple[bool, str, str, float]:
    """(eligible, reason, priority, confidence) 반환"""

    # 신규 신청 불가(모집 종료) 게이트 — '신청할 수 있는 것만 추천' 원칙(프론트 isClosedForNew와 동일)
    if re.search(r"신규\s*(모집|가입|신청)\s*[^,.·(]{0,8}(종료|중단|불가)|모집\s*종료|신규가입.{0,6}종료", doc):
        return False, "", "low", 0.0

    # 소득 상한 게이트 — 명시 상한이 있고 명백히 초과하면 연령이 맞아도 대상 아님(프론트와 동일)
    ceil = _income_ceiling(doc)
    if ceil is not None and profile.income_percentile > ceil:
        return False, "", "low", 0.0

    # 성별 게이트 — 남성에게 여성전용 급여(생리용품·여성청소년·경력단절여성 등) 오추천 방지.
    # 보수적: gender=='male'일 때만(‘other’/미지정은 배제하지 않아 포용). 프론트 welfare-engine.ts와 동일 원칙.
    if getattr(profile, "gender", "other") == "male" and any(
        k in name for k in ["생리", "모유수유", "여성청소년", "여성 청소년", "경력단절여성", "경력단절 여성", "여성가장", "여성새로일하기", "여성경제활동", "여성장애인", "이주여성"]
    ):
        return False, "", "low", 0.0

    # ── 민간재단(PRV-) 가드: 심사·선발형이라 정밀 룰(일반 소득룰 포함)로 '자격 충족'을 단정하지 않는다.
    # 프로필 신호가 맞으면 저신뢰 '관련 지원'으로만 제시 — 프론트 엔진(welfare-engine.ts)과 동일 원칙.
    if pid.startswith("PRV-"):
        text = f"{name} {doc}"
        signal = (
            (19 <= profile.age <= 34 and ("대학생" in text or "장학" in text))
            or (profile.disability and "장애" in text)
            or (profile.has_children and any(k in text for k in ["아동", "환아", "청소년"]))
            or (profile.income_percentile <= 60 and any(k in text for k in ["저소득", "위기", "치료비"]))
        )
        if signal:
            return True, "민간재단 심사·선발형 지원 — 조건이 맞으면 신청해볼 만해요(자세한 자격은 재단 공고 확인)", "low", 0.6
        return False, "", "low", 0.0

    # ── 노인 계열 ──────────────────────────────────────────────────────────
    if any(k in doc for k in ["만 65세", "65세 이상", "만65세"]):
        if profile.age >= 65:
            return True, f"만 {profile.age}세로 연령 기준 충족", "high", 0.95
        return False, "", "low", 0.0

    # '만 66세 이상'(생애전환기 건강검진 등)은 60+에 묶으면 60~65세가 잘못 대상이 된다(감사, 프론트와 패리티) → 66세 별도 게이트.
    if any(k in doc for k in ["만 66세", "66세 이상", "만66세"]):
        if profile.age >= 66:
            return True, f"만 {profile.age}세로 연령 기준 충족", "medium", 0.90
        return False, "", "low", 0.0

    if any(k in doc for k in ["만 60세", "60세 이상", "만60세"]):
        if profile.age >= 60:
            return True, f"만 {profile.age}세로 연령 기준 충족", "medium", 0.90
        return False, "", "low", 0.0

    # ── 청년 계열 ──────────────────────────────────────────────────────────
    if any(k in doc for k in ["만 19~34세", "19~34세", "만 34세 이하", "19세~34세"]):
        if 19 <= profile.age <= 34:
            return True, f"만 {profile.age}세로 청년 연령 기준 충족", "high", 0.92
        return False, "", "low", 0.0

    if any(k in doc for k in ["만 19~39세", "만 39세 이하"]):
        if 19 <= profile.age <= 39:
            return True, f"만 {profile.age}세로 청년 연령 기준 충족", "medium", 0.88
        return False, "", "low", 0.0

    if "만 15~34세" in doc or "15~34세" in doc:
        if 15 <= profile.age <= 34:
            return True, f"만 {profile.age}세로 청년 연령 기준 충족", "high", 0.90
        return False, "", "low", 0.0

    if any(k in doc for k in ["만 9~24세", "9~24세"]):
        if 9 <= profile.age <= 24:
            return True, f"만 {profile.age}세 청소년·청년 기준 충족", "high", 0.88
        return False, "", "low", 0.0

    # ── 장애인 계열 ────────────────────────────────────────────────────────
    if "중증장애인" in doc:
        if profile.disability and profile.disability_grade in ("1급", "2급", "1", "2"):
            return True, f"등록 중증장애인({profile.disability_grade}) 조건 충족", "high", 0.93
        return False, "", "low", 0.0

    if "발달장애인" in doc:
        if profile.disability and any(g in (profile.disability_grade or "") for g in ["지적", "자폐"]):
            return True, f"발달장애인({profile.disability_grade}) 조건 충족", "high", 0.91
        return False, "", "low", 0.0

    if "등록 장애인" in doc or ("장애인" in doc and "장애" in name):
        if profile.disability:
            return True, f"등록 장애인({profile.disability_grade}) 조건 충족", "high", 0.92
        return False, "", "low", 0.0

    # ── 아동·영유아 계열 ──────────────────────────────────────────────────
    if any(k in doc for k in ["만 9세 미만", "만 0~8세", "만 8세 미만", "0세~7세", "만 0~7세"]):
        # 아동수당: 2026년 만 8세 미만 → 9세 미만으로 확대(매년 1세씩 상향)
        if profile.has_children and any(a < 9 for a in (profile.children_ages or [])):
            return True, "만 9세 미만 자녀 보유", "high", 0.97
        return False, "", "low", 0.0

    if any(k in doc for k in ["만 0~5세", "만 0~2세", "영아", "만 24개월"]):
        if profile.has_children and any(a < 3 for a in (profile.children_ages or [])):
            return True, "영유아(만 0~5세) 자녀 보유", "high", 0.96
        return False, "", "low", 0.0

    if "만 12세 이하" in doc:
        if profile.has_children and any(a <= 12 for a in (profile.children_ages or [])):
            return True, "만 12세 이하 자녀 보유", "medium", 0.90
        return False, "", "low", 0.0

    if "만 18세 미만" in doc and "아동" in doc:
        if profile.has_children and any(a < 18 for a in (profile.children_ages or [])):
            return True, "만 18세 미만 자녀 보유", "medium", 0.88
        return False, "", "low", 0.0

    # ── 임산부·출산 계열 ──────────────────────────────────────────────────
    if any(k in doc for k in ["임산부", "임신", "임신확인"]):
        if profile.is_pregnant:
            return True, "임신 중 확인", "high", 0.96
        return False, "", "low", 0.0

    if "출산" in doc and any(k in doc for k in ["산모", "출생", "출생 후"]):
        if profile.is_pregnant or (profile.has_children and any(a == 0 for a in (profile.children_ages or []))):
            return True, "출산(예정) 가정 조건 충족", "high", 0.94
        return False, "", "low", 0.0

    # ── 저소득·기초생활 계열 (2026 정밀 선정기준: 생계32·의료40·주거48·교육/차상위50) ──
    # 여러 급여를 동시에 언급하는 포괄형은 가장 넓은 기준이 적용되도록 넓은 순서로 검사. 프론트 엔진과 일치.
    if any(k in doc for k in ["교육급여", "차상위", "중위소득 50%"]):
        if profile.income_percentile <= 50:
            return True, f"소득 중위소득 {profile.income_percentile}%로 교육급여·차상위 기준 충족", "medium", 0.84
        return False, "", "low", 0.0

    if any(k in doc for k in ["주거급여", "중위소득 48%"]):
        if profile.income_percentile <= 48:
            return True, f"소득 중위소득 {profile.income_percentile}%로 주거급여 기준 충족", "medium", 0.85
        return False, "", "low", 0.0

    if any(k in doc for k in ["의료급여", "중위소득 40%"]):
        if profile.income_percentile <= 40:
            return True, f"소득 중위소득 {profile.income_percentile}%로 의료급여 기준 충족", "high", 0.86
        return False, "", "low", 0.0

    if any(k in doc for k in ["생계급여", "기초생활수급자", "중위소득 30%", "중위소득 32%"]):
        if profile.income_percentile <= 32:
            return True, f"소득 중위소득 {profile.income_percentile}%로 생계급여(기초생활) 기준 충족", "high", 0.87
        return False, "", "low", 0.0

    if any(k in doc for k in ["중위소득 65%"]):
        if profile.income_percentile <= 65:
            return True, f"소득 중위소득 {profile.income_percentile}%로 기준 충족", "medium", 0.82
        return False, "", "low", 0.0

    if any(k in doc for k in ["중위소득 63%"]):
        if profile.income_percentile <= 63:
            return True, f"소득 중위소득 {profile.income_percentile}%로 기준 충족", "medium", 0.82
        return False, "", "low", 0.0

    if any(k in doc for k in ["중위소득 60%"]):
        if profile.income_percentile <= 60:
            return True, f"소득 중위소득 {profile.income_percentile}%로 기준 충족", "medium", 0.82
        return False, "", "low", 0.0

    if any(k in doc for k in ["중위소득 120%", "중위소득 150%", "중위소득 180%"]):
        if profile.income_percentile <= 180:
            return True, f"소득 기준 충족 (중위소득 {profile.income_percentile}%)", "low", 0.75
        return False, "", "low", 0.0

    # ── 실직·취업 계열 ────────────────────────────────────────────────────
    if any(k in doc for k in ["비자발적 이직", "실직", "비자발적 실직자"]):
        if profile.employment_status == "unemployed":
            return True, "실직/비자발적 이직으로 신청 자격 있음", "high", 0.85
        return False, "", "low", 0.0

    if any(k in doc for k in ["구직 중", "미취업", "미취업 청년"]):
        if profile.employment_status == "unemployed":
            return True, "미취업 상태로 신청 자격 있음", "medium", 0.82
        return False, "", "low", 0.0

    # ── 한부모 계열 ────────────────────────────────────────────────────────
    if "한부모가족" in doc or "한부모" in doc or "조손" in doc:
        # 한부모가족지원법상 조손가구도 동일 급여 대상(프론트 welfare-engine과 패리티)
        if profile.household_type in ("한부모가족", "한부모", "조손가구", "조손"):
            return True, "한부모가족 확인", "high", 0.93
        return False, "", "low", 0.0

    # ── 다문화 계열 ────────────────────────────────────────────────────────
    if any(k in doc for k in ["다문화가족", "결혼이민자", "귀화자"]):
        if profile.household_type == "다문화가족":
            return True, "다문화가족 확인", "medium", 0.90
        return False, "", "low", 0.0

    # ── 소득 무관 보편 서비스 ─────────────────────────────────────────────
    if "소득무관" in doc or "소득·재산 무관" in doc:
        return True, "소득 무관 전국민 지원 서비스", "medium", 0.80

    # ── 연령 무관 일반 지원 ────────────────────────────────────────────────
    if any(k in doc for k in ["만 15~69세", "만 15세 이상"]):
        if 15 <= profile.age <= 69:
            return True, f"만 {profile.age}세로 연령 기준 충족", "low", 0.72
        return False, "", "low", 0.0

    return False, "", "low", 0.0


def mock_eligibility(policies: list[dict], profile) -> dict:
    results = []
    for p in policies:
        doc = p.get("document", "") + " " + p.get("eligibility", "")
        name = p.get("name", "")
        pid = p.get("id", "")

        # 샘플 데이터에서 더 상세한 eligibility 텍스트 가져오기
        full = _POLICY_MAP.get(pid, {})
        if full:
            doc = doc + " " + full.get("eligibility", "") + " " + full.get("target", "")

        eligible, reason, priority, confidence = _check_policy(doc, name, pid, profile)

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
            + (", ".join(eligible_names[:4]) + ("..." if len(eligible_names) > 4 else ""))
        ) if eligible_names else "현재 프로필 기준 수혜 가능 정책을 찾지 못했습니다.",
    }


# ── reflection_check mock ────────────────────────────────────────────────────

def mock_reflection(eligible: list[dict], profile) -> dict:
    issues = []
    for p in eligible:
        if not p.get("eligible"):
            continue
        name = p.get("name", "")
        if ("노인" in name or "기초연금" in name) and profile.age < 65:
            issues.append(f"{name}: 연령 기준 불일치 (만 65세 이상 필요)")
        if "청년" in name and (profile.age < 19 or profile.age > 34):
            issues.append(f"{name}: 청년 연령 기준 불일치")
        if "장애" in name and not profile.disability:
            issues.append(f"{name}: 장애인 등록 필요")
        if "임산부" in name and not profile.is_pregnant:
            issues.append(f"{name}: 임신 확인 필요")
    return {
        "passed": len(issues) == 0,
        "issues": issues,
        "summary": "검증 통과" if not issues else f"{len(issues)}건 이슈 발견",
    }


# ── guide_generator mock ─────────────────────────────────────────────────────

_GUIDE_TEMPLATES = {
    "기초연금": {
        "desc": "만 65세 이상 소득 하위 70% 어르신께 매월 최대 334,810원을 지급하는 국가 연금입니다.",
        "steps": [
            "1단계: 주민등록증 지참, 가까운 주민센터·국민연금공단 방문",
            "2단계: 기초연금 수급 신청서 및 금융정보 제공 동의서 작성",
            "3단계: 소득·재산 조사 (약 2~3주 소요)",
            "4단계: 선정 결과 통보 (문자·우편)",
            "5단계: 신청 다음 달부터 매월 25일 지급",
        ],
        "tips": "배우자와 함께 수급 시 각 20% 감액됩니다. 복지로(www.bokjiro.go.kr)에서도 온라인 신청 가능합니다.",
        "days": 30,
    },
    "실업급여": {
        "desc": "비자발적으로 실직한 분이 재취업 활동을 하는 동안 생활을 지원하는 급여입니다.",
        "steps": [
            "1단계: 퇴직 전 이직확인서를 고용보험 사이트(www.ei.go.kr)에서 확인",
            "2단계: 퇴직 후 즉시 고용센터 방문 또는 고용24(www.work.go.kr) 온라인 신청",
            "3단계: 수급자격 인정신청서 및 구직등록",
            "4단계: 수급자격 인정 결정 (약 2주)",
            "5단계: 구직활동 인정 후 실업인정일마다 급여 지급",
        ],
        "tips": "퇴직 후 1년이 지나면 수급 자격이 소멸됩니다. 빨리 신청하세요!",
        "days": 14,
    },
    "아동수당": {
        "desc": "만 8세 미만 아동 모두에게 소득에 관계없이 매월 10만원을 지급합니다.",
        "steps": [
            "1단계: 출생신고 완료 후 즉시 신청 가능",
            "2단계: 복지로·정부24 온라인 또는 주민센터 방문",
            "3단계: 신청인(보호자) 신분증, 주민등록등본 제출",
            "4단계: 신청 후 다음 달부터 지급",
        ],
        "tips": "출생 후 60일 이내 신청하면 출생월부터 소급 지급됩니다. 늦어지면 신청일 기준으로만 지급됩니다.",
        "days": 7,
    },
}

_DEFAULT_STEPS = [
    "1단계: 주민센터 방문 또는 복지로(www.bokjiro.go.kr) 온라인 신청",
    "2단계: 신분증 및 주민등록등본 지참",
    "3단계: 담당자 상담 후 신청서 작성",
    "4단계: 자격 심사 및 결정 통보 (약 2~4주)",
    "5단계: 급여·서비스 지급 시작",
]


def mock_guides(policies: list[dict]) -> dict:
    guides = []
    for p in [ep for ep in policies if ep.get("eligible")][:5]:
        name = p.get("name", "")
        pid = p.get("id", "")
        tmpl = _GUIDE_TEMPLATES.get(name, {})
        full = _POLICY_MAP.get(pid, {})
        guides.append({
            "policy_id": pid,
            "policy_name": name,
            "plain_description": tmpl.get("desc") or full.get("benefit", f"{name} 혜택을 받으실 수 있습니다."),
            "steps": tmpl.get("steps") or _DEFAULT_STEPS,
            "tips": tmpl.get("tips") or f"신청 전 129(복지상담 무료전화)로 서류를 미리 확인하면 편리합니다.",
            "estimated_days": tmpl.get("days") or 14,
        })
    return {"guides": guides}


# ── orchestrator mock ────────────────────────────────────────────────────────

def mock_final_response(eligible: list[dict], docs: list[dict], notifications: list[dict]) -> str:
    eligible_list = [p for p in eligible if p.get("eligible")]
    doc_ok = [d for d in docs if d.get("success")]

    if not eligible_list:
        return (
            "현재 입력하신 프로필 기준으로는 수혜 가능한 정책을 찾지 못했습니다. "
            "프로필 정보를 더 정확하게 입력하시거나, "
            "복지로(www.bokjiro.go.kr) 또는 가까운 주민센터를 방문하시면 전문 상담을 받으실 수 있습니다. "
            "129로 전화하시면 무료 복지 상담도 가능합니다."
        )

    high = [p for p in eligible_list if p.get("priority") == "high"]
    top3 = sorted(eligible_list, key=lambda x: x.get("confidence", 0), reverse=True)[:3]
    names = ", ".join(p["name"] for p in top3)

    sentences = [
        f"분석 결과 수혜 가능 정책 {len(eligible_list)}건을 찾았으며, "
        f"그 중 우선순위 높은 정책이 {len(high)}건입니다.",

        f"가장 먼저 {names} 신청을 권장합니다.",
    ]

    reasons = [f"{p['name']}({p['reason']})" for p in top3 if p.get("reason")]
    if reasons:
        sentences.append("선정 근거: " + ", ".join(reasons) + ".")

    if doc_ok:
        sentences.append(
            f"필요 서류 중 {', '.join(d['doc_name'] for d in doc_ok)} 등 "
            f"{len(doc_ok)}건이 자동 발급되었습니다."
        )

    if notifications:
        notif = notifications[0]
        sentences.append(
            f"생애 이벤트 알림: {notif['title']} — "
            f"{', '.join(notif.get('recommended_policies', [])[:2])} 등을 확인하세요."
        )

    sentences.append(
        "복지로(www.bokjiro.go.kr) 또는 가까운 주민센터에서 신청하시거나, "
        "129 무료 상담 전화를 이용하세요."
    )

    return " ".join(sentences)
