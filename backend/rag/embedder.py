"""복지정책 샘플 데이터 ChromaDB 임베딩 및 검색 — sentence-transformers 내장 임베딩 사용"""
import json
import hashlib
from chromadb.utils.embedding_functions import DefaultEmbeddingFunction
from .chromadb_client import get_collection
from .sample_data import WELFARE_POLICIES

COLLECTION_NAME = "welfare_policies"

_embed_fn = DefaultEmbeddingFunction()

# 검색 결과 캐시 (쿼리 해시 → 결과 리스트)
_search_cache: dict[str, list] = {}


def _policy_to_document(policy: dict) -> str:
    return (
        f"정책명: {policy['name']}\n"
        f"카테고리: {policy['category']}\n"
        f"대상: {policy['target']}\n"
        f"혜택: {policy['benefit']}\n"
        f"자격요건: {policy['eligibility']}\n"
        f"필요서류: {', '.join(policy['required_docs'])}\n"
        f"신청방법: {policy['application']}\n"
        f"담당부처: {policy['department']}"
    )


def seed_chromadb() -> int:
    """샘플 데이터 50건을 ChromaDB에 임베딩. 이미 존재하면 스킵."""
    collection = get_collection(COLLECTION_NAME)

    existing = collection.count()
    if existing >= len(WELFARE_POLICIES):
        print(f"[ModooBom] ChromaDB 이미 {existing}건 임베딩됨 — 스킵")
        return existing

    documents = [_policy_to_document(p) for p in WELFARE_POLICIES]
    ids = [p["id"] for p in WELFARE_POLICIES]
    metadatas = [
        {
            "id": p["id"],
            "name": p["name"],
            "category": p["category"],
            "target": p["target"],
            "required_docs": json.dumps(p["required_docs"], ensure_ascii=False),
            "department": p["department"],
            "renewal": p["renewal"],
        }
        for p in WELFARE_POLICIES
    ]

    vectors = _embed_fn(documents)

    collection.upsert(
        ids=ids,
        embeddings=vectors,
        documents=documents,
        metadatas=metadatas,
    )
    return len(WELFARE_POLICIES)


def warmup():
    """서버 시작 시 임베딩 모델 웜업 — 첫 쿼리 지연 제거"""
    try:
        _embed_fn(["복지 정책 웜업"])
        print("[ModooBom] 임베딩 모델 웜업 완료")
    except Exception as e:
        print(f"[ModooBom] 웜업 스킵: {e}")


def search_policies(query: str, n_results: int = 5) -> list:
    """쿼리와 유사한 복지 정책 검색 (캐시 포함)"""
    cache_key = hashlib.md5(f"{query}:{n_results}".encode()).hexdigest()
    if cache_key in _search_cache:
        return _search_cache[cache_key]

    collection = get_collection(COLLECTION_NAME)
    query_vector = _embed_fn([query])[0]
    results = collection.query(
        query_embeddings=[query_vector],
        n_results=n_results,
        include=["documents", "metadatas", "distances"],
    )

    policies = []
    for i, doc in enumerate(results["documents"][0]):
        meta = results["metadatas"][0][i]
        distance = results["distances"][0][i]
        policies.append(
            {
                "id": meta.get("id"),
                "name": meta.get("name"),
                "category": meta.get("category"),
                "target": meta.get("target"),
                "department": meta.get("department"),
                "renewal": meta.get("renewal"),
                "required_docs": json.loads(meta.get("required_docs", "[]")),
                "document": doc,
                "similarity_score": round(1 - distance, 4),
            }
        )

    # 캐시 크기 제한 (최대 200개)
    if len(_search_cache) >= 200:
        oldest = next(iter(_search_cache))
        del _search_cache[oldest]
    _search_cache[cache_key] = policies
    return policies
