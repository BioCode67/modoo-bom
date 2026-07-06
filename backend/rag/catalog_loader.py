"""실제 복지 카탈로그(frontend/public/policies.json) 로더.

데이터 출처: 공공데이터포털 '한국사회보장정보원 복지서비스'(중앙부처 B554287 + 지자체)를
ETL(backend/etl/ingest_welfare.py)로 정규화·상세승격한 실데이터. 가짜 데이터 없음.
백엔드 RAG(ChromaDB 시딩·BM25 폴백)와 REST 검색이 이 단일 카탈로그를 공유한다.
"""
from __future__ import annotations
import json
import os
import urllib.request
from functools import lru_cache
from pathlib import Path

# backend/rag/catalog_loader.py → parents[2] = 저장소 루트
ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / "frontend" / "public" / "policies.json"

# 백엔드만 배포되는 클라우드(예: Render, Root Directory=backend)에는 frontend/ 가 없다.
# 이때 라이브 배포본에서 동일한 카탈로그를 받아 온다(단일 데이터 출처 유지). 환경변수로 덮어쓸 수 있다.
CATALOG_URL = os.getenv("CATALOG_URL", "https://biocode67.github.io/modoo-bom/policies.json").strip()


def _parse(data) -> list[dict]:
    return data if isinstance(data, list) else data.get("policies", [])


def _from_seed() -> list[dict]:
    """번들된 검증 시드(sample_data)로 폴백 — 어떤 환경에서도 최소 동작 보장."""
    try:
        from .sample_data import WELFARE_POLICIES
        return list(WELFARE_POLICIES)
    except Exception:
        return []


def _merge_seed_first(public: list[dict]) -> list[dict]:
    """검증 시드(전국 핵심정책·정밀 텍스트)를 앞에 두고, 이름이 겹치는 공공데이터(요약형)는 제거.
    → 챗/검색이 '장애인연금·기초연금' 같은 핵심 정책을 풍부한 근거와 함께 우선 노출한다."""
    seed = _from_seed()
    if not seed:
        return public
    seed_names = {(p.get("name") or "").strip() for p in seed}
    rest = [p for p in public if (p.get("name") or "").strip() not in seed_names]
    return seed + rest


@lru_cache(maxsize=1)
def load_catalog() -> list[dict]:
    """정책 카탈로그 로드. 로컬 파일 → 라이브 배포본(원격) → 번들 시드 순으로 폴백.
    공공데이터를 얻으면 검증 시드를 앞에 병합(이름 기준 디듑, 시드 우선)해 검색 품질을 높인다."""
    # ① 로컬 파일(개발 환경 / 풀 저장소 배포)
    if CATALOG_PATH.exists():
        try:
            items = _parse(json.loads(CATALOG_PATH.read_text(encoding="utf-8")))
            if items:
                return _merge_seed_first(items)
        except (json.JSONDecodeError, OSError):
            pass
    # ② 원격(라이브 배포본) — 백엔드만 배포된 클라우드에서 실데이터 확보
    if CATALOG_URL:
        try:
            req = urllib.request.Request(CATALOG_URL, headers={"User-Agent": "modoobom-backend"})
            with urllib.request.urlopen(req, timeout=25) as r:
                items = _parse(json.loads(r.read().decode("utf-8")))
            if items:
                return _merge_seed_first(items)
        except Exception as e:  # 네트워크 실패 등 → 시드 폴백
            print(f"[catalog_loader] 원격 카탈로그 로드 실패({CATALOG_URL}): {e}")
    # ③ 번들 시드 폴백(항상 존재)
    return _from_seed()


def policy_to_document(p: dict) -> str:
    """정책 dict → 임베딩/BM25 색인용 텍스트(실제 필드만 사용)."""
    parts = [
        f"정책명: {p.get('name','')}",
        f"카테고리: {p.get('category','')}",
        f"대상: {p.get('target','')}",
        f"혜택: {p.get('benefit','')}",
        f"자격요건: {p.get('eligibility','')}",
    ]
    docs = p.get("required_docs") or []
    if docs:
        parts.append(f"필요서류: {', '.join(docs)}")
    if p.get("amount_text"):
        parts.append(f"지원금액: {p['amount_text']}")
    parts.append(f"신청방법: {p.get('application','')}")
    parts.append(f"담당부처: {p.get('department','')}")
    return "\n".join(parts)


def policy_to_metadata(p: dict) -> dict:
    """ChromaDB 메타데이터(스칼라만 허용) — 검색 결과 복원용."""
    return {
        "id": p.get("id", ""),
        "name": p.get("name", ""),
        "category": p.get("category", ""),
        "target": (p.get("target") or "")[:500],
        "department": p.get("department", ""),
        "application": p.get("application", ""),
        "amount_krw": int(p["amount_krw"]) if p.get("amount_krw") else 0,
        "is_cash": bool(p.get("is_cash")),
        "required_docs": json.dumps(p.get("required_docs") or [], ensure_ascii=False),
        "renewal": p.get("renewal", ""),
    }
