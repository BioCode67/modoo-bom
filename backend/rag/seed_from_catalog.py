#!/usr/bin/env python3
"""실제 복지 카탈로그(policies.json)를 ChromaDB에 임베딩 시딩.

sample_data.py(120건)만이 아니라 ETL로 수집한 실데이터 전체(수천 건)를 RAG로 검색 가능하게 한다.
메모리 제약(예: Render 무료 512MB)을 고려해 배치 임베딩 + 상한(--limit / RAG_MAX_DOCS)을 지원한다.

사용:
  python -m rag.seed_from_catalog                # 전체(또는 RAG_MAX_DOCS) 시딩
  python -m rag.seed_from_catalog --limit 800    # 상위 800건만(가벼운 배포용)
  RAG_MAX_DOCS=800 python -m rag.seed_from_catalog

데이터 출처는 catalog_loader 참조. 가짜 데이터를 만들지 않는다.
"""
from __future__ import annotations
import argparse
import os
import sys

from .catalog_loader import load_catalog, policy_to_document, policy_to_metadata
from .chromadb_client import get_collection

COLLECTION_NAME = "welfare_policies"


def _rank_key(p: dict):
    """가벼운 배포에서 상한을 둘 때, 현금성·상세정보 보유 정책을 우선 시딩."""
    return (
        1 if p.get("is_cash") else 0,
        1 if p.get("required_docs") else 0,
        p.get("amount_krw") or 0,
    )


def seed_from_catalog(limit: int | None = None, batch: int = 256) -> int:
    """카탈로그를 배치로 임베딩해 ChromaDB upsert. 반환: 시딩 건수."""
    from chromadb.utils.embedding_functions import DefaultEmbeddingFunction

    catalog = load_catalog()
    if not catalog:
        print("[seed] 카탈로그가 비어있습니다(frontend/public/policies.json). ETL을 먼저 실행하세요.")
        return 0

    if limit:
        catalog = sorted(catalog, key=_rank_key, reverse=True)[:limit]

    embed_fn = DefaultEmbeddingFunction()
    collection = get_collection(COLLECTION_NAME)

    total = 0
    for start in range(0, len(catalog), batch):
        chunk = catalog[start:start + batch]
        docs = [policy_to_document(p) for p in chunk]
        ids = [p.get("id") or f"CAT-{start+i}" for i, p in enumerate(chunk)]
        metas = [policy_to_metadata(p) for p in chunk]
        vectors = embed_fn(docs)
        collection.upsert(ids=ids, embeddings=vectors, documents=docs, metadatas=metas)
        total += len(chunk)
        print(f"[seed] {total}/{len(catalog)} 임베딩 완료")
    print(f"[seed] ✅ ChromaDB 시딩 {total}건 (collection={COLLECTION_NAME})")
    return total


def main() -> int:
    ap = argparse.ArgumentParser(description="복지 카탈로그 → ChromaDB 시딩")
    ap.add_argument("--limit", type=int, default=int(os.getenv("RAG_MAX_DOCS", "0")) or None,
                    help="시딩 최대 건수(메모리 제약 배포용). 미지정 시 전체")
    ap.add_argument("--batch", type=int, default=256)
    args = ap.parse_args()
    return 0 if seed_from_catalog(limit=args.limit, batch=args.batch) else 1


if __name__ == "__main__":
    sys.exit(main())
