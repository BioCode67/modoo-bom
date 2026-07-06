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
    # 카탈로그를 먼저 예열(원격 fetch가 있는 백엔드 전용 배포 대비). 이 캐시(lru_cache)가 채워지면
    # 이후 /health·/search·챗 요청 경로에서 블로킹 urlopen이 이벤트 루프를 멈추는 일이 없다.
    # RAG 시딩과 분리해, ChromaDB 시딩이 실패해도 카탈로그는 확실히 예열되게 한다.
    try:
        from rag.catalog_loader import load_catalog
        load_catalog()
    except Exception as e:
        log.warning("카탈로그 예열 스킵: %s", e)
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
_ALLOWED_ORIGINS = [o.strip() for o in cors_origins if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 크롬의 Private Network Access(공개 https 사이트 → 로컬 http 에이전트 호출) 프리플라이트 통과용.
#
# ⚠️ Starlette CORSMiddleware 는 `Access-Control-Request-Private-Network: true` 프리플라이트를
#    기본적으로 400('Disallowed CORS private-network')으로 **거부**한다(PNA 옵트인 미지원).
#    그래서 CORS 미들웨어보다 바깥쪽(나중에 add)인 이 미들웨어에서 PNA 프리플라이트를 **가로채**
#    직접 200 + 허용 헤더로 응답한다 → 브라우저가 로컬 에이전트 호출을 허용한다.
#    (일반 요청/일반 프리플라이트는 그대로 CORSMiddleware 가 처리)
from starlette.responses import Response as _Response


@app.middleware("http")
async def _allow_private_network(request, call_next):
    origin = request.headers.get("origin")
    is_pna_preflight = (
        request.method == "OPTIONS"
        and request.headers.get("access-control-request-private-network") == "true"
    )
    if is_pna_preflight and origin in _ALLOWED_ORIGINS:
        acrm = request.headers.get("access-control-request-method", "*")
        acrh = request.headers.get("access-control-request-headers", "*")
        return _Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Allow-Methods": acrm,
                "Access-Control-Allow-Headers": acrh,
                "Access-Control-Allow-Private-Network": "true",
                "Access-Control-Max-Age": "600",
                "Vary": "Origin",
            },
        )
    response = await call_next(request)
    # 비프리플라이트 응답에도 PNA 헤더를 붙여 후속 요청을 매끄럽게(허용 오리진일 때만).
    if origin in _ALLOWED_ORIGINS:
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


# ── 로컬 데스크탑 앱: 프론트를 백엔드가 '동일 출처'로 직접 서빙 ──
# frontend/dist-app(로컬 전용 빌드: `npm run build:app`, base='/', VITE_API_BASE=''(동일출처))가
# 있으면 '/'에 마운트한다. 사용자가 http://localhost:8000/ 을 열면 추천·서류발급·신청이 모두
# 동일 출처에서 돌아, 브라우저의 CORS·PNA·LNA(로컬네트워크 접근) 권한 프롬프트가 아예 없다 →
# 자동 서류발급이 프롬프트 없이 매끄럽게 동작(배포 HTTPS→localhost 브릿지의 근본 제약 회피).
# (클라우드에는 이 디렉터리가 없어 마운트 스킵. API/WS 라우트가 먼저 등록돼 항상 우선함.)
from pathlib import Path as _Path

_APP_DIR = _Path(__file__).resolve().parent.parent / "frontend" / "dist-app"
if _APP_DIR.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=str(_APP_DIR), html=True), name="local-app")
    log.info("로컬 데스크탑 앱 서빙 활성: %s → http://127.0.0.1:%s/", _APP_DIR, os.getenv("PORT", "8000"))


if __name__ == "__main__":
    import uvicorn
    # 로컬 실행 기본은 127.0.0.1(루프백) — 개인정보를 다루는 로컬 RPA 에이전트가 LAN에 노출되지 않게.
    # 클라우드(Render 등)는 자체 start 명령(uvicorn --host 0.0.0.0 --port $PORT)으로 구동하므로 무관.
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
