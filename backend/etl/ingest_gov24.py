#!/usr/bin/env python3
"""보조금24(행정안전부 '대한민국 공공서비스(혜택) 정보', data.go.kr 15113968) ETL.

기존 카탈로그(B554287 사회보장 복지서비스)가 못 덮는 **보조금·바우처·감면** 계열
중앙부처+지자체 수혜서비스를 Policy 스키마로 정규화해 policies.json에 병합한다.

정직성 원칙(중요):
- 이 모듈은 컨테이너(정부망 차단)에서 응답 스키마를 실측하지 못한 채 작성됐다.
  그래서 필드 매핑은 **후보 키 관용 매핑**(_gpick)으로 두고, 실행 전 반드시
  `--probe` 로 실제 응답의 키 목록을 눈으로 확인하는 절차를 강제한다.
- 가짜 데이터를 만들지 않는다. 응답에 없는 필드는 비워 두고 정직하게 저장한다.

사용(사용자 PC, data.go.kr 활용신청 후):
  1) 키 준비: backend/.env 의 DATA_GO_KR_SERVICE_KEY (기존 ETL과 같은 키,
     단 15113968 '대한민국 공공서비스(혜택) 정보' 활용신청이 별도로 필요)
  2) 스키마 확인: python etl/ingest_gov24.py --probe
     → 실제 키 목록·샘플 1건 출력. 아래 _CAND 후보에 없는 키가 보이면 추가.
  3) 수집·병합:   python etl/ingest_gov24.py --run
     → frontend/public/policies.json 에 기존 항목 우선으로 이름 디듑 병합.
  4) 반영:        cd frontend && npm run deploy  (또는 build:app)
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest_welfare import (  # noqa: E402 — 기존 ETL 헬퍼 재사용(정규화·저장 동작 통일)
    _get_with_retry,
    clean,
    dedupe,
    enrich_fields,
    make_policy,
    save_catalog,
)

BASE = "https://api.odcloud.kr/api/gov24/v3"
LIST_URL = f"{BASE}/serviceList"
DETAIL_URL = f"{BASE}/serviceDetail"

OUT_DEFAULT = Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "policies.json"

# 후보 키 매핑 — 보조금24 응답은 한국어 키를 쓴다(공개 문서·활용사례 기준 후보).
# --probe 로 실측한 키가 여기 없으면 이 목록에 추가하면 된다(코드 다른 곳은 수정 불필요).
_CAND = {
    "sid": ("서비스ID", "서비스아이디", "svcId"),
    "name": ("서비스명", "서비스이름"),
    "summary": ("서비스목적요약", "서비스목적", "서비스요약"),
    "target": ("지원대상", "지원 대상"),
    "eligibility": ("선정기준", "선정 기준"),
    "benefit": ("지원내용", "지원 내용"),
    "application": ("신청방법", "신청 방법"),
    "deadline": ("신청기한",),
    "url": ("상세조회URL", "온라인신청사이트URL", "상세조회 URL"),
    "department": ("소관기관명", "소관부처명", "소관 기관명"),
    "dept2": ("부서명",),
    "contact": ("전화문의", "문의처"),
    "user_type": ("사용자구분",),
}

_SIDO = (
    "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시",
    "울산광역시", "세종특별자치시", "경기도", "강원특별자치도", "강원도", "충청북도",
    "충청남도", "전북특별자치도", "전라북도", "전라남도", "경상북도", "경상남도",
    "제주특별자치도",
)


def _gpick(row: dict, *cands: str) -> str:
    """후보 키들 중 실제로 존재하는 첫 값을 반환(관용 매핑)."""
    for k in cands:
        v = row.get(k)
        if v:
            return str(v)
    return ""


def _region_of(department: str) -> str:
    """소관기관명이 지자체(시도로 시작)면 그 시도명을 지역으로 쓴다 — LOC- 프리픽스·지역배지용."""
    d = clean(department)
    for s in _SIDO:
        if d.startswith(s):
            return s
    return ""


def normalize_row(row: dict) -> dict:
    """보조금24 한 행 → Policy 스키마. sid에 B24 네임스페이스를 붙여 기존 GOV/LOC와 충돌 방지."""
    dept = _gpick(row, *_CAND["department"])
    application = _gpick(row, *_CAND["application"])
    deadline = _gpick(row, *_CAND["deadline"])
    if deadline and deadline not in application:
        application = clean(f"{application} (신청기한: {deadline})") if application else f"신청기한: {deadline}"
    p = make_policy(
        sid=f"B24{_gpick(row, *_CAND['sid'])}" if _gpick(row, *_CAND["sid"]) else "",
        name=_gpick(row, *_CAND["name"]),
        summary=_gpick(row, *_CAND["summary"]),
        target=_gpick(row, *_CAND["target"]),
        eligibility=_gpick(row, *_CAND["eligibility"]),
        benefit=_gpick(row, *_CAND["benefit"]),
        application=application,
        department=" ".join(x for x in (dept, _gpick(row, *_CAND["dept2"])) if x),
        url=_gpick(row, *_CAND["url"]),
        region=_region_of(dept),
        contact=_gpick(row, *_CAND["contact"]),
    )
    return enrich_fields(p)


def _fetch_pages(service_key: str, max_pages: int, per_page: int, probe: bool = False) -> list[dict]:
    import httpx

    rows: list[dict] = []
    with httpx.Client(timeout=30) as client:
        for page in range(1, max_pages + 1):
            r = _get_with_retry(
                client, LIST_URL,
                {"serviceKey": service_key, "page": page, "perPage": per_page},
                f"gov24 p{page}",
            )
            if r is None:
                break
            try:
                body = r.json()
            except ValueError:
                print(f"[gov24] p{page}: JSON 아님 — 응답 앞부분: {r.text[:200]}")
                break
            data = body.get("data") or []
            if probe:
                return data[:3]
            rows.extend(data)
            total = body.get("totalCount") or 0
            print(f"[gov24] p{page}: 누적 {len(rows)}/{total}건")
            if not data or (total and len(rows) >= total):
                break
    return rows


def run_probe(service_key: str) -> int:
    sample = _fetch_pages(service_key, max_pages=1, per_page=3, probe=True)
    if not sample:
        print("[gov24] ❌ 샘플 0건 — 키·활용신청(15113968)·네트워크를 확인하세요.")
        return 1
    keys = sorted({k for row in sample for k in row})
    known = {c for cands in _CAND.values() for c in cands}
    print("[gov24] 실측 응답 키:", ", ".join(keys))
    unknown = [k for k in keys if k not in known]
    if unknown:
        print("[gov24] ⚠️ 후보 매핑에 없는 키:", ", ".join(unknown), "— 필요하면 _CAND에 추가하세요.")
    print("[gov24] 샘플 1건 정규화 미리보기:")
    p = normalize_row(sample[0])
    for k in ("id", "name", "target", "benefit", "application", "department"):
        print(f"   {k}: {str(p.get(k, ''))[:80]}")
    return 0


def run_ingest(service_key: str, max_pages: int, out_path: Path) -> int:
    import json

    rows = _fetch_pages(service_key, max_pages=max_pages, per_page=100)
    if not rows:
        print("[gov24] ❌ 수집 0건 — --probe 로 키·스키마부터 확인하세요.")
        return 1
    new_policies = [normalize_row(r) for r in rows]
    new_policies = [p for p in new_policies if p["name"]]

    existing: list[dict] = []
    if out_path.exists():
        try:
            existing = json.loads(out_path.read_text(encoding="utf-8"))
        except ValueError:
            print(f"[gov24] ⚠️ 기존 카탈로그 파싱 실패 — 새로 만듭니다: {out_path}")
    # 이름 디듑(기존 우선) — 같은 제도가 B554287과 겹치면 기존(복지로 딥링크 보유) 항목 유지
    seen_names = {clean(p.get("name", "")).replace(" ", "") for p in existing}
    fresh = [p for p in new_policies if clean(p["name"]).replace(" ", "") not in seen_names]
    merged = dedupe(existing + fresh)
    print(f"[gov24] 신규 {len(new_policies)}건 중 이름중복 {len(new_policies) - len(fresh)}건 제외 → "
          f"기존 {len(existing)} + 추가 {len(fresh)} = {len(merged)}건")
    if not save_catalog(out_path, merged):
        return 1
    print(f"[gov24] ✅ 저장: {out_path} — 반영은 frontend에서 npm run deploy(웹) 또는 build:app(데스크탑)")
    return 0


def main() -> int:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")

    ap = argparse.ArgumentParser(description="보조금24 수혜서비스 → 모두봄 카탈로그 병합")
    ap.add_argument("--probe", action="store_true", help="실제 응답 키·샘플만 출력(수집 전 필수 확인)")
    ap.add_argument("--run", action="store_true", help="수집·병합 실행")
    ap.add_argument("--max-pages", type=int, default=120, help="최대 페이지(기본 120 × 100건)")
    ap.add_argument("--out", type=str, default=str(OUT_DEFAULT))
    args = ap.parse_args()

    key = os.getenv("DATA_GO_KR_SERVICE_KEY", "").strip()
    if not key:
        print("[gov24] ❌ DATA_GO_KR_SERVICE_KEY 가 없습니다 — backend/.env 에 설정하세요.\n"
              "        (data.go.kr에서 '대한민국 공공서비스(혜택) 정보'(15113968) 활용신청 필요)")
        return 1
    if args.probe:
        return run_probe(key)
    if args.run:
        return run_ingest(key, args.max_pages, Path(args.out))
    print("사용법: --probe (스키마 확인) → --run (수집·병합)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
