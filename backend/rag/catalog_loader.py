"""실제 복지 카탈로그(frontend/public/policies.json) 로더.

데이터 출처: 공공데이터포털 '한국사회보장정보원 복지서비스'(중앙부처 B554287 + 지자체)를
ETL(backend/etl/ingest_welfare.py)로 정규화·상세승격한 실데이터. 가짜 데이터 없음.
백엔드 RAG(ChromaDB 시딩·BM25 폴백)와 REST 검색이 이 단일 카탈로그를 공유한다.
"""
from __future__ import annotations
import json
from functools import lru_cache
from pathlib import Path

# backend/rag/catalog_loader.py → parents[2] = 저장소 루트
ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / "frontend" / "public" / "policies.json"


@lru_cache(maxsize=1)
def load_catalog() -> list[dict]:
    """policies.json 을 읽어 Policy dict 리스트로 반환(없으면 빈 리스트)."""
    if not CATALOG_PATH.exists():
        return []
    try:
        data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else data.get("policies", [])


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
