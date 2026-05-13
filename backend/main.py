"""ModooBom FastAPI 서버 엔트리포인트"""
import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router
from api.websocket import websocket_endpoint


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 서버 시작 시 ChromaDB 샘플 데이터 자동 시딩 (sentence-transformers 내장 임베딩 사용)
    try:
        from rag.embedder import seed_chromadb
        count = seed_chromadb()
        print(f"[ModooBom] ChromaDB 초기화 완료 — {count}건 임베딩")
    except Exception as e:
        print(f"[ModooBom] ChromaDB 초기화 스킵: {e}")
    yield


app = FastAPI(
    title="ModooBom API",
    description="개인 복지 자산 관리 AI Agent — 3주차 프로토타입",
    version="0.3.0",
    lifespan=lifespan,
)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.websocket("/ws/analyze")
async def ws_analyze(ws: WebSocket):
    await websocket_endpoint(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
