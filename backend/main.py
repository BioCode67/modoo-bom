"""ModooBom FastAPI 서버 엔트리포인트"""
import os
import sys
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# ⚠️ Windows 콘솔 기본 인코딩(cp949)에서 로그·RPA 진행메시지의 이모지(✅📱—)를 출력하면
#    UnicodeEncodeError가 나고, 그게 이벤트 루프/서버 프로세스를 죽인다(실측 크래시). UTF-8을 강제해 원천 차단.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

load_dotenv()

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from logging_config import get_logger
from api.routes import router
from api.websocket import websocket_endpoint
from api.chat import chat_websocket_endpoint

log = get_logger("modoobom")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 서버 시작 시 RAG 초기화. 경량 모드(RAG_LIGHT/클라우드)면 BM25 인메모리 색인,
    # 아니면 ChromaDB + sentence-transformers 임베딩 시딩. (저메모리 배포 OOM 방지)
    try:
        from rag.search import seed, warmup, backend_label
        count, kind = seed()
        log.info("RAG 초기화 완료 — %s · %d건", backend_label(), count)
        warmup()
    except Exception as e:
        log.warning("RAG 초기화 스킵: %s", e)
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


# 전역 예외 처리 — 예상 못 한 오류의 스택트레이스가 클라이언트로 새지 않게(내부정보 유출 차단).
# 상세는 서버 로그에만 남기고, 클라이언트엔 일반 메시지 + 500.
from fastapi import Request
from fastapi.responses import JSONResponse


@app.exception_handler(Exception)
async def _unhandled_exception(request: Request, exc: Exception):
    log.error("처리되지 않은 오류 [%s %s]: %s", request.method, request.url.path, exc)
    return JSONResponse(status_code=500, content={"detail": "서버에서 문제가 발생했어요. 잠시 후 다시 시도해 주세요."})


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
