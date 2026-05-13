"""복지정책 샘플 데이터 ChromaDB 임베딩 및 검색"""
import json
import os
from langchain_openai import OpenAIEmbeddings
from .chromadb_client import get_collection
from .sample_data import WELFARE_POLICIES


COLLECTION_NAME = "welfare_policies"


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
        return existing

    embeddings_model = OpenAIEmbeddings(model="text-embedding-3-small")

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

    vectors = embeddings_model.embed_documents(documents)

    collection.upsert(
        ids=ids,
        embeddings=vectors,
        documents=documents,
        metadatas=metadatas,
    )
    return len(WELFARE_POLICIES)


def search_policies(query: str, n_results: int = 5) -> list[dict]:
    """쿼리와 유사한 복지 정책 검색"""
    collection = get_collection(COLLECTION_NAME)
    embeddings_model = OpenAIEmbeddings(model="text-embedding-3-small")

    query_vector = embeddings_model.embed_query(query)
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
    return policies
