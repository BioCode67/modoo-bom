"""ChromaDB 클라이언트 및 초기화"""
import os
import chromadb
from chromadb.config import Settings

_client: chromadb.ClientAPI | None = None


def get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")
        _client = chromadb.PersistentClient(
            path=persist_dir,
            settings=Settings(anonymized_telemetry=False),
        )
    return _client


def get_collection(name: str = "welfare_policies") -> chromadb.Collection:
    client = get_client()
    return client.get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
    )
