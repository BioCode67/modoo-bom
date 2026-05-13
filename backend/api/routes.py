"""FastAPI REST 라우터"""
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from rag.embedder import search_policies, seed_chromadb
from mocks.gov24_api import issue_document, _doc_store
from agents.mock_responses import is_mock_mode

router = APIRouter(prefix="/api")


class SearchRequest(BaseModel):
    query: str
    n_results: int = 5


class DocRequest(BaseModel):
    doc_name: str
    user_name: str = "홍길동"


@router.get("/health")
async def health():
    """서버 상태 + 환경 정보 반환"""
    from rag.chromadb_client import get_collection
    try:
        col = get_collection()
        doc_count = col.count()
        chroma_ok = True
    except Exception as e:
        doc_count = 0
        chroma_ok = False

    return {
        "status": "ok",
        "service": "ModooBom API",
        "version": "0.3.0",
        "mode": "mock" if is_mock_mode() else "production",
        "openai_key_set": bool(os.getenv("OPENAI_API_KEY", "").startswith("sk-") and not is_mock_mode()),
        "chromadb": {
            "ok": chroma_ok,
            "document_count": doc_count,
            "seeded": doc_count >= 50,
        },
    }


@router.get("/health/ready")
async def readiness():
    """Kubernetes-style readiness probe"""
    return {"ready": True}


@router.post("/search")
async def search(req: SearchRequest):
    if is_mock_mode():
        # Mock 검색: 샘플 데이터에서 키워드 매칭
        from rag.sample_data import WELFARE_POLICIES
        results = [
            {**p, "similarity_score": 0.85, "document": p["eligibility"]}
            for p in WELFARE_POLICIES
            if req.query.lower() in (p["name"] + p["category"] + p["target"]).lower()
        ][:req.n_results] or [
            {**p, "similarity_score": 0.70, "document": p["eligibility"]}
            for p in WELFARE_POLICIES[:req.n_results]
        ]
        return {"policies": results, "count": len(results), "mode": "mock"}

    results = search_policies(req.query, req.n_results)
    return {"policies": results, "count": len(results), "mode": "production"}


@router.post("/documents/issue")
async def issue_doc(req: DocRequest):
    result = await issue_document(req.doc_name, req.user_name)
    return result


@router.get("/documents/view/{receipt_number}", response_class=HTMLResponse)
async def view_document(receipt_number: str):
    """발급된 Mock 서류를 HTML로 반환 (브라우저에서 직접 열기 / 인쇄)"""
    html = _doc_store.get(receipt_number)
    if not html:
        raise HTTPException(status_code=404, detail="서류를 찾을 수 없습니다. (만료되었거나 존재하지 않는 접수번호)")
    return HTMLResponse(content=html)


@router.post("/admin/seed")
async def seed_data():
    """ChromaDB 샘플 데이터 임베딩 (초기화용). Mock 모드에서는 스킵."""
    if is_mock_mode():
        return {"message": "Mock 모드 — 시딩 스킵", "mode": "mock", "count": 0}
    count = seed_chromadb()
    return {"message": f"{count}건 임베딩 완료", "mode": "production", "count": count}


@router.get("/admin/status")
async def db_status():
    from rag.chromadb_client import get_collection
    try:
        col = get_collection()
        return {
            "collection": "welfare_policies",
            "document_count": col.count(),
            "mode": "mock" if is_mock_mode() else "production",
        }
    except Exception as e:
        return {"error": str(e), "document_count": 0}


@router.get("/admin/env")
async def env_check():
    """환경변수 상태 확인 (키 값은 마스킹)"""
    openai_key = os.getenv("OPENAI_API_KEY", "")
    return {
        "OPENAI_API_KEY": f"{'set (' + openai_key[:8] + '...)' if openai_key else 'not set'}",
        "CHROMA_PERSIST_DIR": os.getenv("CHROMA_PERSIST_DIR", "./chroma_db"),
        "CORS_ORIGINS": os.getenv("CORS_ORIGINS", "http://localhost:5173"),
        "mock_mode": is_mock_mode(),
    }
