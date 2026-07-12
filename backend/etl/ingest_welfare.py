#!/usr/bin/env python3
"""
모두봄 복지정책 카탈로그 ETL — 공공데이터를 우리 Policy 스키마로 정규화.

"사이트마다 복지정책이 다른" 문제를 해결하기 위해, 정부 공식 공개데이터에서
복지서비스 목록을 모아 단일 카탈로그(frontend/public/policies.json)로 만든다.
프론트엔드(catalog.ts)가 이 파일을 런타임에 병합하므로, 코드 수정/재빌드 없이
정책 수를 수백~수천 건으로 확장할 수 있다.

⚠️ 가짜 데이터를 만들지 않는다. 실제 공개데이터만 정규화한다.

입력 모드 (둘 중 하나):
  1) CSV 모드 (키 불필요, 추천 — 가장 쉬움)
     공공데이터포털 '한국사회보장정보원_복지서비스정보'(중앙부처 367건)는
     로그인 없이 CSV 다운로드 가능:
       https://www.data.go.kr/data/15083323/fileData.do  → [다운로드]
     받은 CSV를 넘겨라:
       python etl/ingest_welfare.py --csv ~/Downloads/한국사회보장정보원_복지서비스정보_*.csv

  2) API 모드 (무료 키 필요, 가장 포괄적 — 중앙부처 1600+건, 지자체 수천 건)
     공공데이터포털 회원가입 → '한국사회보장정보원_중앙부처복지서비스'(B554287) 활용신청(즉시 승인)
     발급키를 환경변수로:
       export DATA_GO_KR_SERVICE_KEY='발급받은_디코딩키'
       python etl/ingest_welfare.py --api

출력: frontend/public/policies.json  (Policy[] JSON)
"""
from __future__ import annotations
import argparse
import csv
import io
import json
import os
import re
import sys
from pathlib import Path

import hashlib

# Windows 콘솔(cp949)에서 이모지 print가 UnicodeEncodeError로 죽는 것 방지
# (데이터 저장은 됐는데 마지막 안내 출력에서 크래시하던 버그 — 2026-07 실측)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / "frontend" / "public" / "policies.json"

# ── 카테고리 추론 (서비스명/요약 키워드 → 우리 카테고리 버킷) ──────────────────
_CATEGORY_RULES = [
    ("노인", ["노인", "어르신", "고령", "기초연금", "장기요양"]),
    ("아동·영유아", ["아동", "영유아", "보육", "어린이", "유아", "출산", "양육", "보육료", "부모급여"]),
    ("청년", ["청년", "대학생", "취업준비", "구직"]),
    ("장애인", ["장애"]),
    ("임신·출산", ["임신", "임산부", "산모", "출산", "난임"]),
    ("저소득", ["저소득", "기초생활", "생계", "차상위", "수급자", "긴급복지"]),
    ("주거", ["주거", "전세", "월세", "임대", "주택", "보금자리"]),
    ("의료", ["의료", "건강", "질병", "치료", "재활", "병원", "검진"]),
    ("고용", ["고용", "취업", "일자리", "실업", "근로", "직업훈련", "창업"]),
    ("교육", ["교육", "장학", "학자금", "학습", "학교", "평생교육"]),
    ("문화", ["문화", "여가", "스포츠", "관광", "예술"]),
    ("가족", ["한부모", "다문화", "가족", "다자녀", "조손"]),
    # --- 공공데이터 '기타' 정교화 (위 규칙에 미매칭된 항목만 재분류 → 기존 분류 무영향) ---
    ("보훈", ["유공자", "보훈", "제대군인", "참전", "애국지사", "무공", "고엽제", "6.25", "원폭", "사할린", "영주귀국", "독립유공"]),
    ("탈북민", ["북한이탈", "탈북"]),
    ("농어민", ["농어가", "어선", "농업인", "농식품", "도서민", "어업", "수산"]),
    ("여성복지", ["여성", "가정폭력", "성폭력", "위안부"]),
    ("청소년", ["청소년"]),
    ("의료", ["마음투자", "정신건강", "심리상담"]),
    ("아동·영유아", ["입양", "다함께 돌봄"]),
    ("문화", ["산림복지", "큰글자책", "도서 보급"]),
    ("저소득", ["노숙인", "에너지바우처", "취약계층", "채무조정", "통합사례관리", "희망복지", "통신요금", "이동통신"]),
]


def infer_category(text: str) -> str:
    t = text or ""
    for label, kws in _CATEGORY_RULES:
        if any(k in t for k in kws):
            return label
    return "기타"


def clean(s) -> str:
    if s is None:
        return ""
    return re.sub(r"\s+", " ", str(s)).strip()


# ── 현금성/금액 추출 (실제 지원내용 텍스트에서 파생 — 가짜 생성 아님) ─────────────
# 정부 복지 안내문의 실제 금액 표기("월 30만원", "최대 100만원", "300,000원", "연 200만원")를
# 정규식으로 뽑아 정렬/필터/합산에 쓸 정수(월 환산 우선)와 표시 문자열을 만든다.
# 값을 지어내지 않는다 — 원문에 금액이 없으면 amount_krw=None(현금성 아님으로 취급).
_CASH_KEYWORDS = ("지원금", "수당", "급여", "장려금", "바우처", "보조금", "지원비", "생계",
                  "현금", "저축", "카드", "이용권", "포인트", "장학금", "학자금", "연금")
_AMOUNT_RE = re.compile(
    r"(?:(?P<period>월|매월|월별|연|년|1회|일시|1인당|가구당|최대)\s*)?"
    r"(?P<num>[0-9][0-9,\.]*)\s*(?P<unit>만\s*원|원|만)"
)


def extract_amount(*texts: str) -> dict:
    """실제 지원내용 문장에서 대표 금액을 추출. 여러 후보 중 '월' 표기를 우선, 없으면 최댓값.

    반환: {"amount_krw": int|None(원 단위, 월 우선), "amount_text": str, "period": str, "is_cash": bool}
    """
    blob = " ".join(t for t in texts if t)
    if not blob:
        return {"amount_krw": None, "amount_text": "", "period": "", "is_cash": False}
    cands = []  # (krw, period, raw)
    for m in _AMOUNT_RE.finditer(blob):
        raw_num = m.group("num").replace(",", "").rstrip(".")
        try:
            val = float(raw_num)
        except ValueError:
            continue
        unit = m.group("unit").replace(" ", "")
        krw = int(val * 10000) if unit.startswith("만") else int(val)
        if krw < 1000:  # '만' 없는 3자리 이하는 금액 아닐 확률 높음(횟수/나이 등) — 잡음 제거
            continue
        period = (m.group("period") or "").replace(" ", "")
        cands.append((krw, period, m.group(0).strip()))
    if not cands:
        return {"amount_krw": None, "amount_text": "", "period": "",
                "is_cash": any(k in blob for k in _CASH_KEYWORDS)}
    # 월 표기 후보 우선, 그 안에서 최댓값 → 없으면 전체 최댓값
    monthly = [c for c in cands if c[1] in ("월", "매월", "월별")]
    pick = max(monthly or cands, key=lambda c: c[0])
    return {"amount_krw": pick[0], "amount_text": pick[2], "period": pick[1] or "",
            "is_cash": True}


# ── 자격 조건 태그 추출 (나이/소득/가구/지역 — 실제 대상·선정기준 문장에서) ──────
_HOUSEHOLD_TAGS = {
    "한부모": ["한부모", "조손"], "다자녀": ["다자녀", "세자녀", "3자녀", "다둥이"],
    "노인": ["노인", "어르신", "고령", "65세"], "장애인": ["장애"],
    "청년": ["청년", "대학생"], "임신·출산": ["임신", "임산부", "산모", "출산", "난임"],
    "아동": ["아동", "영유아", "보육", "어린이"], "저소득": ["저소득", "기초생활", "차상위", "수급"],
    "다문화": ["다문화", "결혼이민", "외국인"], "농어민": ["농업인", "어업인", "농어가"],
}
_INCOME_RE = re.compile(r"(중위소득|기준중위소득)\s*(?P<pct>[0-9]{1,3})\s*%|소득인정액|소득[^.]{0,6}이하")

# 나이 조건 — '만 N세' 뒤에 바로 붙는 경계 표현만 신뢰한다.
#   이상→min · 초과→min+1 · 이하→max · 미만→max-1 · (~ / - / 부터)→범위의 하한
# 경계어 없는 단독/나열/오타 토큰('만 20세', '만 20세 또는 25세')은 잘못된 자격 차단
# (오게이트)을 막기 위해 조용히 무시한다. op 그룹은 '세' 바로 뒤 1개만 캡처하므로
# mid가 다음 절까지 삼키던 문제도 없다.
MAX_AGE = 120
_AGE_RE = re.compile(r"(?:만\s*)?(?P<age>[0-9]{1,3})\s*세\s*(?P<op>이상|이하|미만|초과|부터|~|-)?")


def extract_conditions(*texts: str) -> dict:
    """대상/선정기준 문장에서 나이·소득·가구·지역 신호를 구조화(있는 것만).

    나이는 '만 N세 이상/이하/미만/초과' 또는 'N세~M세'(부터/~) 범위처럼 **명시적
    경계**만 받아들인다. '만 20세 또는 25세'처럼 경계어 없는 나열·오타 텍스트는
    잘못된 자격 차단(오게이트)을 막기 위해 조용히 건너뛴다. 값을 지어내지 않는다.
    """
    blob = " ".join(t for t in texts if t)
    conds: dict = {}
    if not blob:
        return conds
    hh = [tag for tag, kws in _HOUSEHOLD_TAGS.items() if any(k in blob for k in kws)]
    if hh:
        conds["household"] = hh
    inc = _INCOME_RE.search(blob)
    if inc:
        conds["income"] = (inc.group("pct") + "% 이하") if inc.group("pct") else "소득 요건 있음"

    lo = hi = None
    range_open = False  # 직전 토큰이 '~'/'부터'로 범위의 하한을 열어둔 상태
    for m in _AGE_RE.finditer(blob):          # ← 모든 '세' 토큰 순회
        val = int(m.group("age"))
        if not (0 <= val <= MAX_AGE):   # 연도·코드 등 잡음 배제
            continue
        op = m.group("op")
        if op == "이상":
            if lo is None:
                lo = val
        elif op == "초과":
            if lo is None:
                lo = val + 1
        elif op == "이하":
            if hi is None:
                hi = val
        elif op == "미만":
            if hi is None:
                hi = val - 1
        elif op in ("~", "-", "부터"):
            if lo is None:
                lo = val
            range_open = True
        elif range_open and hi is None:   # 범위의 상한 ('N세~M세'의 M)
            hi = val
            range_open = False
        # else: 경계어 없는 단독/모호 토큰 → 무시(오게이트 방지)
        # ↑ 만약 단독 'N세'를 정확 연령으로 보고 싶다면 이 자리에서
        #   if lo is None and hi is None: lo = hi = val 로 바꾸면 된다(비권장).

    if lo is not None and hi is not None and lo > hi:
        lo = hi = None   # 앞뒤가 뒤집힌 모순 파싱은 통째로 버림
    if lo is not None or hi is not None:
        age: dict = {}
        if lo is not None:
            age["min"] = lo
        if hi is not None:
            age["max"] = hi
        conds["age"] = age
    return conds


def enrich_fields(p: dict) -> dict:
    """정책 dict에 금액/조건/현금성 파생 필드를 추가(원문 기반, 값 조작 없음)."""
    amt = extract_amount(p.get("benefit", ""), p.get("target", ""), p.get("name", ""))
    conds = extract_conditions(p.get("eligibility", ""), p.get("target", ""), p.get("benefit", ""))
    p["amount_krw"] = amt["amount_krw"]
    p["amount_text"] = amt["amount_text"]
    p["is_cash"] = amt["is_cash"]
    if conds:
        p["conditions"] = conds
    return p


def make_policy(*, sid: str, name: str, summary: str = "", target: str = "",
                eligibility: str = "", benefit: str = "", application: str = "",
                department: str = "", docs=None, url: str = "", region: str = "",
                contact: str = "") -> dict:
    """소스 필드를 우리 Policy 스키마로 정규화. 누락 필드는 보수적으로 채운다."""
    name = clean(name)
    summary = clean(summary)
    if len(summary) > 200:  # 카드/드로어 가독성 + 파일 크기: 요약은 200자로 제한(전문은 복지로 딥링크)
        summary = summary[:200].rstrip() + '…'
    region = clean(region)
    id_prefix = "LOC" if region else "GOV"
    target_full = (f"[{region}] " if region else "") + (clean(target) or summary)
    dept_full = clean(department) or (f"{region} 지자체" if region else "정부부처")
    return {
        "id": f"{id_prefix}-{clean(sid)}"
        if sid
        else f"{id_prefix}-{int(hashlib.sha256((region + name).encode()).hexdigest(), 16) % 10_000_000}",
        "name": name,
        "category": infer_category(name + " " + summary + " " + clean(target)),
        "target": target_full,
        "benefit": clean(benefit) or summary,
        "eligibility": clean(eligibility) or clean(target) or summary,
        "required_docs": docs or [],
        "application": clean(application) or (clean(url) or "복지로(www.bokjiro.go.kr) 또는 주민센터"),
        "department": dept_full,
        "renewal": "기관 안내 확인",
        "contact": clean(contact),
    }

    # sha256() : 문자열이 아니라 bytes를 받아야함, 반환값은 SHA-256 해시 객체. 또한 abs()를 적용할 수 없음.
    # encode() : 문자열을 바이트로 변환.
    # hexdigest() : 해시 객체를 16진수 문자열로 변환.
    # int(, 16) : int가 10진수라고 헷갈리지 않기위해 사용.

   # md5 : 충돌을 인위적으로 만드는 취약점이 존재함.

# ── CSV 모드 ──────────────────────────────────────────────────────────────────
# 중앙부처 복지서비스정보 CSV 컬럼: 서비스아이디,서비스명,서비스URL,서비스요약,사이트,대표문의,소관부처명,소관조직명,기준연도,최종수정일
def _read_csv_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp949", "euc-kr", "utf-8"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _pick(row: dict, *names: str) -> str:
    for n in names:
        for k in row:
            if k and k.replace(" ", "") == n.replace(" ", ""):
                return row[k]
    return ""


def ingest_csv(path: Path) -> list[dict]:
    text = _read_csv_text(path)
    reader = csv.DictReader(io.StringIO(text))
    out = []
    for row in reader:
        name = _pick(row, "서비스명", "급여명", "사업명")
        if not name:
            continue
        sido = _pick(row, "시도명", "시도", "광역시도명")
        sgg = _pick(row, "시군구명", "시군구")
        region = clean(f"{sido} {sgg}").strip()
        out.append(make_policy(
            sid=_pick(row, "서비스아이디", "서비스ID", "서비스id"),
            name=name,
            summary=_pick(row, "서비스요약", "요약", "서비스목적요약", "지원내용"),
            target=_pick(row, "지원대상", "선정기준"),
            department=_pick(row, "소관부처명", "소관기관명", "부서명", "담당부서"),
            application=_pick(row, "신청방법"),
            url=_pick(row, "서비스URL", "상세조회URL"),
            region=region,
            contact=_pick(row, "대표문의", "문의처", "전화번호"),
        ))
    return out


# ── 한국장학재단 학자금지원정보 CSV (기업·민간재단·지자체·대학 장학금 1,800+건) ──
# data.go.kr/data/15028252/fileData.do (로그인 불필요 CSV). 정부 복지 DB엔 없는
# 민간/기업/지역 장학금을 포함 → "국가 외 경제적 수혜"를 실데이터로 보강한다.
# 컬럼: 운영기관명,상품명,운영기관구분,상품구분,학자금유형구분,대학/학년/학과구분,
#       성적기준/소득기준/지원내역/특정자격/지역거주여부/선발방법/선발인원/자격제한/
#       추천필요여부/제출서류 상세내용,홈페이지 주소,모집시작일,모집종료일
def ingest_kosaf_csv(path: Path) -> list[dict]:
    import hashlib
    text = _read_csv_text(path)
    reader = csv.DictReader(io.StringIO(text))
    out: list[dict] = []
    for row in reader:
        name = _pick(row, "상품명", "장학상품명", "장학금명", "장학사업명")
        if not name:
            continue
        org = _pick(row, "운영기관명", "운영기관", "기관명")
        org_type = _pick(row, "운영기관구분", "기관구분")
        benefit = _pick(row, "지원내역 상세내용", "지원내역상세내용", "지원내역", "지원내용")
        grade = _pick(row, "성적기준 상세내용", "성적기준상세내용", "성적기준")
        income = _pick(row, "소득기준 상세내용", "소득기준상세내용", "소득기준")
        special = _pick(row, "특정자격 상세내용", "특정자격상세내용", "특정자격")
        limit = _pick(row, "자격제한 상세내용", "자격제한상세내용", "자격제한")
        yearg = _pick(row, "학년구분")
        majorg = _pick(row, "학과구분")
        region_res = _pick(row, "지역거주여부 상세내용", "지역거주여부상세내용", "지역거주여부")
        docs_raw = _pick(row, "제출서류 상세내용", "제출서류상세내용", "제출서류")
        home = _pick(row, "홈페이지 주소", "홈페이지주소", "홈페이지", "URL")
        start = _pick(row, "모집시작일", "접수시작일")
        end = _pick(row, "모집종료일", "접수종료일")

        elig = " / ".join(clean(x) for x in (grade, income, special, limit) if clean(x))
        target = " / ".join(clean(x) for x in (org_type, yearg, majorg, region_res) if clean(x)) or "대학생·대학원생"
        docs = [d.strip() for d in re.split(r"[,/·\n]+", docs_raw) if d.strip()] if docs_raw else []
        url = clean(home)
        url = url if url.startswith("http") else ""
        sid = hashlib.md5((clean(org) + clean(name)).encode("utf-8")).hexdigest()[:8]
        p = {
            "id": f"SCH-{sid}",
            "name": clean(name),
            "category": "교육",
            "target": clean(target),
            "benefit": clean(benefit) or "장학금 지원",
            "eligibility": elig or clean(target),
            "required_docs": docs,
            "application": url or "https://www.kosaf.go.kr",  # 실제 운영기관 홈페이지 우선, 없으면 한국장학재단
            "department": clean(org) or "장학재단",
            "renewal": (f"{clean(start)}~{clean(end)}" if (clean(start) or clean(end)) else "기관 안내 확인"),
            "contact": "",
            "org_type": clean(org_type),   # 지자체/민간재단/대학/기업 등 — 필터/배지용
            "scholarship": True,
        }
        if clean(end):
            p["deadline"] = clean(end)
        out.append(p)
    return out


# ── API 모드 (한국사회보장정보원 중앙부처복지서비스 B554287) ────────────────────
WELFARE_LIST_URL = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001"


def _get_with_retry(client, url, params, label, attempts: int = 3):
    """일시적 오류(401/429/5xx/타임아웃)에 짧게 재시도. 정식 키 호출의 견고화용."""
    import time
    last = ""
    for a in range(1, attempts + 1):
        try:
            r = client.get(url, params=params)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last = str(e).splitlines()[0][:140]
            if a < attempts:
                time.sleep(0.8 * a)
    print(f"[{label}] {attempts}회 재시도 실패: {last}")
    return None


def ingest_api(service_key: str, max_pages: int = 60, rows: int = 100) -> list[dict]:
    import httpx
    import xml.etree.ElementTree as ET

    out: list[dict] = []
    with httpx.Client(timeout=30.0) as client:
        for page in range(1, max_pages + 1):
            params = {
                "serviceKey": service_key,
                "callTp": "L",
                "pageNo": page,
                "numOfRows": rows,
                "srchKeyCode": "001",  # 통합검색
            }
            r = _get_with_retry(client, WELFARE_LIST_URL, params, f"etl page{page}")
            if r is None:
                break
            try:
                root = ET.fromstring(r.text)
            except ET.ParseError:
                print(f"[etl] page {page}: XML 파싱 실패 — 키/응답 확인 필요\n{r.text[:300]}")
                break
            items = root.findall(".//servList")
            if not items:
                # 첫 페이지부터 비면 키/엔드포인트 문제일 수 있음
                if page == 1:
                    msg = root.findtext(".//errMsg") or root.findtext(".//returnAuthMsg") or r.text[:300]
                    print(f"[etl] 응답에 항목 없음 (page1). 메시지: {msg}")
                break
            for it in items:
                def g(tag): return it.findtext(tag) or ""
                out.append(make_policy(
                    sid=g("servId"),
                    name=g("servNm"),
                    summary=g("servDgst"),
                    target=g("trgterIndvdlArray") or g("bizChrDeptNm"),
                    benefit=g("servDgst"),
                    application=g("aplyMtdNm"),
                    department=g("jurMnofNm"),
                    url=g("servDtlLink") or g("servSeKrNm"),
                ))
            print(f"[etl] page {page}: 누적 {len(out)}건")
            if len(items) < rows:
                break
    return out


# ── API 모드 (지자체 복지서비스 B554287 LocalGovernment) ───────────────────────
LOCAL_LIST_URL = "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist"


def ingest_local_api(service_key: str, max_pages: int = 200, rows: int = 100) -> list[dict]:
    import httpx
    import xml.etree.ElementTree as ET

    out: list[dict] = []
    fails = 0
    with httpx.Client(timeout=30.0) as client:
        for page in range(1, max_pages + 1):
            params = {"serviceKey": service_key, "pageNo": page, "numOfRows": rows}
            r = _get_with_retry(client, LOCAL_LIST_URL, params, f"etl/local page{page}")
            if r is None:
                fails += 1
                if fails >= 3:
                    print("[etl/local] 연속 실패 — 수집 중단(받은 데이터는 저장)")
                    break
                continue
            fails = 0
            try:
                root = ET.fromstring(r.text)
            except Exception as e:
                print(f"[etl/local] page {page} 파싱 실패: {str(e)[:120]}")
                break
            items = root.findall(".//servList")
            if not items:
                if page == 1:
                    print(f"[etl/local] 항목 없음. 메시지: {(root.findtext('.//errMsg') or r.text[:200])}")
                break
            for it in items:
                def g(tag): return it.findtext(tag) or ""
                region = clean(f"{g('ctpvNm')} {g('sggNm')}")
                out.append(make_policy(
                    sid=g("servId"), name=g("servNm"), summary=g("servDgst"),
                    target=g("trgterIndvdlArray"),
                    application=g("aplyMtdNm"), department=g("bizChrDeptNm"),
                    url=g("servDtlLink"), region=region,
                ))
            print(f"[etl/local] page {page}: 누적 {len(out)}건")
            if len(items) < rows:
                break
    return out


# ── 온통청년 청년정책 API (한국고용정보원, JSON) ───────────────────────────────
# ⚠️ 키(YOUTH_API_KEY)가 나오면 실행. 응답 필드명이 API 버전에 따라 달라, 첫 페이지 원본 샘플을
#    로그로 남겨(필드명 검증) 필요 시 아래 _pick 키 목록만 손보면 되도록 방어적으로 작성했다.
YOUTH_API_URL = "https://www.youthcenter.go.kr/go/ythip/getPlcy"


def _first_list(obj):
    """응답 JSON에서 정책 리스트 배열을 방어적으로 찾는다(응답 구조 변형 대응)."""
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        for k in ("youthPolicyList", "result", "youthPolicy", "list", "data", "items", "empList"):
            v = obj.get(k)
            if isinstance(v, list):
                return v
            if isinstance(v, dict):
                inner = _first_list(v)
                if inner:
                    return inner
    return []


# 주의: CSV용 _pick(공백무시 퍼지매칭, 위쪽)과 이름이 겹치지 않게 별도 명명.
# (동일 이름이면 모듈 로드 시 나중 정의가 CSV용을 섀도잉해 헤더 공백/BOM 매칭이 깨진다.)
def _ypick(d: dict, *keys) -> str:
    """JSON 응답용 값 선택 — 정확 키 조회, 빈값/'null'/'-'는 건너뜀."""
    for k in keys:
        v = d.get(k)
        if v not in (None, "", "null", "-"):
            return str(v).strip()
    return ""


def ingest_youth(api_key: str, max_pages: int = 60, rows: int = 100) -> list[dict]:
    """온통청년 청년정책 목록 수집(JSON) → Policy 스키마 정규화(GOV-YTH… 접두사)."""
    import httpx
    out: list[dict] = []
    with httpx.Client(timeout=30.0) as client:
        for page in range(1, max_pages + 1):
            params = {"apiKeyNm": api_key, "pageNum": page, "pageSize": rows, "rtnType": "json"}
            r = _get_with_retry(client, YOUTH_API_URL, params, f"etl/youth page{page}")
            if r is None:
                break
            try:
                data = r.json()
            except Exception:
                print(f"[etl/youth] JSON 파싱 실패(page{page}). 응답:\n{r.text[:300]}")
                break
            items = _first_list(data)
            if not items:
                if page == 1:
                    print(f"[etl/youth] 항목 없음(page1) — 키/권한/엔드포인트 확인:\n"
                          f"{json.dumps(data, ensure_ascii=False)[:400]}")
                break
            if page == 1:  # 첫 페이지 원본 샘플 → 필드명 검증용
                print(f"[etl/youth] 원본 샘플(필드명 확인):\n{json.dumps(items[0], ensure_ascii=False)[:600]}")
            for it in items:
                if not isinstance(it, dict):
                    continue
                name = _ypick(it, "plcyNm", "polyBizSjnm", "polyBizSjNm")
                if not name:
                    continue
                explain = _ypick(it, "plcyExplnCn", "polyItcnCn")
                support = _ypick(it, "plcySprtCn", "sporCn")
                amin, amax = _ypick(it, "sprtTrgtMinAge"), _ypick(it, "sprtTrgtMaxAge")
                age = f"만 {amin}~{amax}세" if (amin or amax) else _ypick(it, "ageInfo")
                target = _ypick(it, "sprtTrgtDtlCn", "empmSttsCn", "majrRqisCn")
                apply_url = _ypick(it, "aplyUrlAddr", "rqutUrla", "refUrlAddr1")
                apply_how = _ypick(it, "plcyAplyMthdCn", "rqutProcCn")
                dept = _ypick(it, "sprvsnInstCdNm", "rgtrInstCdNm", "cnsgNmor")
                pno = _ypick(it, "plcyNo", "bizId")
                out.append(make_policy(
                    sid=f"YTH{pno}" if pno else "",
                    name=name, summary=explain,
                    target=f"{age} {target}".strip(),
                    eligibility=_ypick(it, "addAplyQlfcCndCn") or target or explain,
                    benefit=support or explain,
                    application=apply_how or apply_url,
                    department=dept or "온통청년(한국고용정보원)",
                    url=apply_url,
                ))
            print(f"[etl/youth] page {page}: 누적 {len(out)}건")
            if len(items) < rows:
                break
    return out


# ── 상세 API 인리치먼트 (중앙부처 servId → 금액/조건/서류/실제 신청URL) ──────────
DETAIL_URL = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfaredetailedV001"


def fetch_detail(client, service_key: str, serv_id: str) -> dict | None:
    """중앙부처 복지서비스 상세 조회 → 실제 지원내용/대상/선정기준/서식/온라인신청URL 파싱.

    servSeCode 의미: 010 문의처 · 020 온라인신청(URL) · 030 관련법령 · 040 서식(구비서류) · 070 신청방법
    """
    import xml.etree.ElementTree as ET
    r = _get_with_retry(client, DETAIL_URL,
                        {"serviceKey": service_key, "callTp": "D", "servId": serv_id},
                        f"detail {serv_id}")
    if r is None:
        return None
    try:
        root = ET.fromstring(r.text)
    except ET.ParseError:
        return None

    def g(tag: str) -> str:
        return clean(root.findtext(f".//{tag}") or "")

    docs, online_url, apply_how, phone = [], "", [], ""
    for blk in root.findall(".//servList"):
        code = (blk.findtext("servSeCode") or "").strip()
        nm = clean(blk.findtext("servSeDetailNm") or "")
        link = clean(blk.findtext("servSeDetailLink") or "")
        if code == "040" and nm and nm not in docs:      # 서식 = 구비서류/신청서
            docs.append(nm)
        elif code == "020" and link.startswith("http"):   # 온라인 신청 실제 URL
            online_url = online_url or link
        elif code == "070" and link:                      # 신청 방법 설명
            apply_how.append(link)
        elif code == "010" and link:
            phone = phone or link
    return {
        "benefit": g("alwServCn") or g("wlfareInfoOutlCn"),
        "target": g("tgtrDtlCn"),
        "eligibility": g("slctCritCn") or g("tgtrDtlCn"),
        "required_docs": docs,
        "online_apply": online_url,
        "apply_method": " / ".join(apply_how)[:300],
        "contact": g("rprsCtadr") or phone,
        "crtr_yr": g("crtrYr"),
    }


def enrich_from_detail(policies: list[dict], service_key: str) -> int:
    """GOV-(중앙부처) 정책을 상세 API로 승격. 반환: 승격 성공 건수."""
    import httpx
    targets = [p for p in policies if p["id"].startswith("GOV-WLF")]
    done, consec_fail = 0, 0
    with httpx.Client(timeout=30.0) as client:
        for i, p in enumerate(targets, 1):
            serv_id = p["id"].split("GOV-", 1)[1]
            d = fetch_detail(client, service_key, serv_id)
            if not d:
                consec_fail += 1
                # 상세 오퍼레이션 미승인(401 등)이면 460건을 재시도로 헛돌지 않고 즉시 중단.
                if done == 0 and consec_fail >= 8:
                    print("[etl/enrich] 상세 API가 연속 실패합니다(인증/승인 문제로 추정) → 중단. "
                          "data.go.kr에서 '중앙부처 복지서비스 상세' 오퍼레이션 활용신청이 필요할 수 있어요.")
                    break
                continue
            consec_fail = 0
            if d["benefit"]:
                p["benefit"] = d["benefit"][:400]
            if d["target"]:
                p["target"] = d["target"][:400]
            if d["eligibility"]:
                p["eligibility"] = d["eligibility"][:400]
            if d["required_docs"]:
                p["required_docs"] = d["required_docs"]
            # 실제 온라인 신청 URL이 있으면 신청 링크로 승격, 없으면 기존 복지로 딥링크 유지
            if d["online_apply"]:
                p["application"] = d["online_apply"]
            if d["apply_method"]:
                p["apply_method"] = d["apply_method"]
            if d["contact"]:
                p["contact"] = d["contact"]
            if d["crtr_yr"]:
                p["crtr_yr"] = d["crtr_yr"]
            done += 1
            if i % 50 == 0:
                print(f"[etl/enrich] {i}/{len(targets)} 처리 (승격 {done})")
    return done


# ── 병합/저장 ─────────────────────────────────────────────────────────────────
def dedupe(policies: list[dict]) -> list[dict]:
    seen, out = set(), []
    for p in policies:
        key = p["id"] or p["name"]
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="모두봄 복지정책 ETL")
    ap.add_argument("--csv", type=str, help="공개 CSV 경로 (키 불필요). 여러 개면 콤마로 구분")
    ap.add_argument("--api", action="store_true", help="중앙부처 OpenAPI (DATA_GO_KR_SERVICE_KEY 필요)")
    ap.add_argument("--local", action="store_true", help="지자체 OpenAPI (DATA_GO_KR_SERVICE_KEY 필요)")
    ap.add_argument("--enrich", action="store_true",
                    help="기존 policies.json의 중앙부처 항목을 상세 API로 승격(금액/조건/서류/실제 신청URL)")
    ap.add_argument("--derive", action="store_true",
                    help="네트워크 없이 기존 policies.json에 금액/조건/현금성 파생필드만 적용")
    ap.add_argument("--kosaf", type=str,
                    help="한국장학재단 학자금지원정보 CSV 경로 → 기업/민간/지자체/대학 장학금을 기존 카탈로그에 병합")
    ap.add_argument("--youth", action="store_true",
                    help="온통청년 청년정책 API 수집 → 기존 카탈로그에 병합 (YOUTH_API_KEY 필요)")
    ap.add_argument("--out", type=str, default=str(DEFAULT_OUT), help="출력 JSON 경로")
    ap.add_argument("--max-pages", type=int, default=60)
    args = ap.parse_args()

    # --kosaf 병합 모드: 한국장학재단 장학금 CSV를 기존 카탈로그에 병합(기존 우선 디듑) + 파생
    if args.kosaf:
        out_path = Path(args.out).expanduser()
        existing = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else []
        path = Path(args.kosaf).expanduser()
        if not path.exists():
            print(f"[etl] 장학재단 CSV 없음: {path}\n"
                  "      data.go.kr/data/15028252/fileData.do 에서 CSV 다운로드(로그인 불필요) 후 경로를 넘기세요.")
            return 1
        sch = ingest_kosaf_csv(path)
        print(f"[etl] 한국장학재단 CSV에서 장학금 {len(sch)}건")
        combined = dedupe([p for p in (existing + sch) if p.get("name")])  # 기존 우선
        for p in combined:
            enrich_fields(p)
        out_path.write_text(json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")
        added = len(combined) - len(existing)
        cash = sum(1 for p in combined if p.get("is_cash"))
        print(f"[etl] ✅ 병합 완료 — 총 {len(combined)}건(+{added} 장학금) · 현금성 {cash} → {out_path}")
        return 0

    # --youth 병합 모드: 온통청년 청년정책을 수집해 기존 카탈로그에 병합(기존 우선 디듑) + 파생
    if args.youth:
        key = os.getenv("YOUTH_API_KEY", "").strip()
        if not key:
            print("[etl] --youth 에는 YOUTH_API_KEY 가 필요합니다.\n"
                  "      온통청년(youthcenter.go.kr) 마이페이지 → OPEN API 에서 발급 후 backend/.env 에 설정하세요.")
            return 1
        out_path = Path(args.out).expanduser()
        existing = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else []
        yth = ingest_youth(key, max_pages=args.max_pages)
        print(f"[etl] 온통청년에서 청년정책 {len(yth)}건")
        if not yth:
            print("[etl] 수집 0건 — 위 로그(원본 샘플/오류 메시지)를 확인하세요. 기존 파일은 그대로 둡니다.")
            return 1
        combined = dedupe([p for p in (existing + yth) if p.get("name")])  # 기존 우선
        for p in combined:
            enrich_fields(p)
        out_path.write_text(json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")
        added = len(combined) - len(existing)
        print(f"[etl] ✅ 병합 완료 — 총 {len(combined)}건(+{added} 청년정책) → {out_path}")
        return 0

    # --derive 단독 모드: API 호출 없이 기존 카탈로그에 금액/조건/현금성 파생필드만 부여
    if args.derive and not (args.csv or args.api or args.local or args.enrich):
        out_path = Path(args.out).expanduser()
        if not out_path.exists():
            print(f"[etl] 기존 카탈로그가 없습니다: {out_path}")
            return 1
        existing = json.loads(out_path.read_text(encoding="utf-8"))
        for p in existing:
            enrich_fields(p)
        out_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
        cash = sum(1 for p in existing if p.get("is_cash"))
        amt = sum(1 for p in existing if p.get("amount_krw"))
        cond = sum(1 for p in existing if p.get("conditions"))
        print(f"[etl] ✅ 파생 적용 {len(existing)}건 · 현금성 {cash} · 금액추출 {amt} · 조건 {cond} → {out_path}")
        return 0

    # --enrich 단독 모드: 새로 수집하지 않고 기존 카탈로그를 상세정보로 승격 + 파생필드 재계산
    if args.enrich and not (args.csv or args.api or args.local):
        key = os.getenv("DATA_GO_KR_SERVICE_KEY", "").strip()
        if not key:
            print("[etl] --enrich 에는 DATA_GO_KR_SERVICE_KEY 가 필요합니다.")
            return 1
        out_path = Path(args.out).expanduser()
        if not out_path.exists():
            print(f"[etl] 기존 카탈로그가 없습니다: {out_path} (먼저 --api/--local 로 수집)")
            return 1
        existing = json.loads(out_path.read_text(encoding="utf-8"))
        print(f"[etl] 기존 {len(existing)}건 로드 → 중앙부처 상세 승격 시작")
        promoted = enrich_from_detail(existing, key)
        for p in existing:
            enrich_fields(p)
        out_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
        cash = sum(1 for p in existing if p.get("is_cash"))
        docs = sum(1 for p in existing if p.get("required_docs"))
        print(f"[etl] ✅ 승격 {promoted}건 · 현금성 {cash}건 · 서류보유 {docs}건 → {out_path}")
        return 0

    policies: list[dict] = []

    if args.csv:
        for csv_path in args.csv.split(","):
            path = Path(csv_path.strip()).expanduser()
            if not path.exists():
                print(f"[etl] CSV 없음: {path}")
                continue
            got = ingest_csv(path)
            policies += got
            print(f"[etl] CSV({path.name})에서 {len(got)}건")

    if args.api or args.local:
        key = os.getenv("DATA_GO_KR_SERVICE_KEY", "").strip()
        if not key:
            print("[etl] DATA_GO_KR_SERVICE_KEY 환경변수가 필요합니다.\n"
                  "      공공데이터포털에서 중앙부처/지자체 복지서비스(B554287) 활용신청 후 디코딩 키를 설정하세요.")
            return 1
        if args.api:
            got = ingest_api(key, max_pages=args.max_pages)
            policies += got
            print(f"[etl] 중앙부처 API에서 {len(got)}건")
        if args.local:
            got = ingest_local_api(key, max_pages=max(args.max_pages, 200))
            policies += got
            print(f"[etl] 지자체 API에서 {len(got)}건")

    if not args.csv and not args.api and not args.local:
        print(__doc__)
        print("\n[etl] 입력 모드를 지정하세요: --csv <파일>  /  --api(중앙부처)  /  --local(지자체)")
        return 0

    policies = dedupe([p for p in policies if p["name"]])
    if not policies:
        print("[etl] 정규화된 정책이 없습니다. 입력/키를 확인하세요. (가짜 데이터는 생성하지 않음)")
        return 1

    # 상세 승격(선택) → 그 뒤 전체에 금액/조건 파생필드 부여
    if args.enrich:
        key = os.getenv("DATA_GO_KR_SERVICE_KEY", "").strip()
        if key:
            enrich_from_detail(policies, key)
    for p in policies:
        enrich_fields(p)

    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(policies, ensure_ascii=False, indent=2), encoding="utf-8")
    cats = {}
    for p in policies:
        cats[p["category"]] = cats.get(p["category"], 0) + 1
    print(f"[etl] ✅ {len(policies)}건 저장 → {out_path}")
    print(f"[etl] 카테고리 분포: {dict(sorted(cats.items(), key=lambda x: -x[1]))}")
    print("[etl] 프론트는 다음 빌드/배포 시 이 파일을 자동 병합합니다 (npm run deploy).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
