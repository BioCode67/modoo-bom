"""ModooBom FastAPI 서버 엔트리포인트"""
import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router
from api.websocket import websocket_endpoint
from api.chat import chat_websocket_endpoint


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 서버 시작 시 RAG 초기화. 경량 모드(RAG_LIGHT/클라우드)면 BM25 인메모리 색인,
    # 아니면 ChromaDB + sentence-transformers 임베딩 시딩. (저메모리 배포 OOM 방지)
    try:
        from rag.search import seed, warmup, backend_label
        count, kind = seed()
        print(f"[ModooBom] RAG 초기화 완료 — {backend_label()} · {count}건")
        warmup()
    except Exception as e:
        print(f"[ModooBom] RAG 초기화 스킵: {e}")
    yield


app = FastAPI(
    title="ModooBom API",
    description="개인 복지 자산 관리 AI Agent — 3주차 프로토타입",
    version="0.3.0",
    lifespan=lifespan,
)

# 로컬 개발(5173) + 배포 웹(github.io)이 이 로컬 에이전트를 호출할 수 있게 허용.
# (배포 웹이 사용자 PC의 에이전트를 감지→호출하는 '로컬 에이전트 브릿지'용)
cors_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,https://biocode67.github.io",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cors_origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 크롬의 Private Network Access(공개 https 사이트 → 로컬 http 에이전트 호출) 프리플라이트 통과용.
# 이 미들웨어는 CORS 미들웨어보다 나중에 추가되어 '바깥쪽'에 위치 → 프리플라이트 응답에도 헤더가 붙음.
@app.middleware("http")
async def _allow_private_network(request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


# 레이트 리미트 — 공개 배포 시 남용·LLM 비용 폭주 방지(가장 바깥쪽에서 먼저 차단).
from api.rate_limit import rate_limit_middleware
app.middleware("http")(rate_limit_middleware)


app.include_router(router)


@app.websocket("/ws/analyze")
async def ws_analyze(ws: WebSocket):
    await websocket_endpoint(ws)


@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket):
    await chat_websocket_endpoint(ws)


if __name__ == "__main__":
    import uvicorn
    # 로컬 실행 기본은 127.0.0.1(루프백) — 개인정보를 다루는 로컬 RPA 에이전트가 LAN에 노출되지 않게.
    # 클라우드(Render 등)는 자체 start 명령(uvicorn --host 0.0.0.0 --port $PORT)으로 구동하므로 무관.
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
