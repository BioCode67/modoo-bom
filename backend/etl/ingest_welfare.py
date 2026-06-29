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


def make_policy(*, sid: str, name: str, summary: str = "", target: str = "",
                eligibility: str = "", benefit: str = "", application: str = "",
                department: str = "", docs=None, url: str = "", region: str = "",
                contact: str = "") -> dict:
    """소스 필드를 우리 Policy 스키마로 정규화. 누락 필드는 보수적으로 채운다."""
    name = clean(name)
    summary = clean(summary)
    region = clean(region)
    id_prefix = "LOC" if region else "GOV"
    target_full = (f"[{region}] " if region else "") + (clean(target) or summary)
    dept_full = clean(department) or (f"{region} 지자체" if region else "정부부처")
    return {
        "id": f"{id_prefix}-{clean(sid)}" if sid else f"{id_prefix}-{abs(hash(region + name)) % 10_000_000}",
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


# ── API 모드 (한국사회보장정보원 중앙부처복지서비스 B554287) ────────────────────
WELFARE_LIST_URL = "http://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001"


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
            r = client.get(WELFARE_LIST_URL, params=params)
            r.raise_for_status()
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
LOCAL_LIST_URL = "http://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist"


def ingest_local_api(service_key: str, max_pages: int = 200, rows: int = 100) -> list[dict]:
    import httpx
    import xml.etree.ElementTree as ET

    out: list[dict] = []
    with httpx.Client(timeout=30.0) as client:
        for page in range(1, max_pages + 1):
            params = {"serviceKey": service_key, "pageNo": page, "numOfRows": rows}
            try:
                r = client.get(LOCAL_LIST_URL, params=params)
                r.raise_for_status()
                root = ET.fromstring(r.text)
            except Exception as e:
                print(f"[etl/local] page {page} 실패: {str(e)[:120]}")
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
                    target=g("trgterIndvdlArray") or g("bizChrDeptNm"),
                    application=g("aplyMtdNm"), department=g("bizChrDeptNm"),
                    url=g("servDtlLink"), region=region,
                ))
            print(f"[etl/local] page {page}: 누적 {len(out)}건")
            if len(items) < rows:
                break
    return out


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
    ap.add_argument("--out", type=str, default=str(DEFAULT_OUT), help="출력 JSON 경로")
    ap.add_argument("--max-pages", type=int, default=60)
    args = ap.parse_args()

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
