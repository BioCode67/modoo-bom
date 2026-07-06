"""모두봄 로컬 데스크탑 에이전트 — 경량 서버(설치본 전용).

목적: 사용자 PC에서 ① 프론트(dist-app)를 '동일 출처'로 서빙 + ② 실제 RPA 서류발급/신청만
담당한다. 무거운 RAG/LLM 스택(chromadb·langchain·langgraph)을 **임포트하지 않으므로**
① 시작이 즉시(수 초) — main.py 는 chromadb 시딩에 ~수십 초 소요
② PyInstaller 등으로 단일 실행파일 번들이 현실적(fastapi+uvicorn+playwright 만 의존)

추천·검색·챗봇 등 AI 기능은 프론트가 클라이언트 엔진(welfare-engine·on-device 임베딩)으로
스스로 수행하므로, 로컬 에이전트가 AI를 제공하지 않아도 전 기능이 동작한다(capabilities.ai=false).
클라우드(Render)용 풀스택은 기존 main.py 를 그대로 사용한다(이 파일은 로컬 설치본 전용).

동일 출처(localhost:8000)라 브라우저 CORS·PNA·LNA(로컬네트워크 접근) 권한 프롬프트가 전혀 없어
자동 서류발급이 매끄럽게 동작한다.

실행:  python -m uvicorn local_server:app --host 127.0.0.1 --port 8000
       (또는 run-local-app.bat / 번들 실행파일)
"""
import os
import sys
import hmac
import socket
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path

# Windows 콘솔(cp949)에서 이모지 로그가 UnicodeEncodeError 를 내지 않도록 UTF-8 강제(긴 RPA 대기 중 크래시 차단).
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

# 번들(PyInstaller) 실행 시 backend 디렉터리를 모듈 경로로 — rpa.* 임포트 보장.
_BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
if str(_BASE) not in sys.path:
    sys.path.insert(0, str(_BASE))

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response as _Response
from pydantic import BaseModel

def _detect_browser() -> str:
    """서류 자동발급에 쓸 브라우저를 사람이 읽는 이름으로(안내용). 실제 선택은 launch_browser 폴백."""
    if sys.platform == "win32":
        for p in (
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        ):
            if os.path.exists(p):
                return "Chrome"
        return "Microsoft Edge"  # Windows 10/11 선탑재
    return "Chrome/Chromium"


def _print_banner():
    port = os.getenv("PORT", "8000")
    line = "═" * 52
    print("\n" + line)
    print("  🌱 모두봄 로컬 에이전트 실행 중")
    print(f"  ▶ 브라우저에서 열기 :  http://localhost:{port}/")
    print(f"  ▶ 자동발급 브라우저 :  {_detect_browser()}")
    print("  ▶ 종료              :  이 창을 닫거나 Ctrl+C")
    print(line + "\n", flush=True)


@asynccontextmanager
async def _lifespan(_app):
    _print_banner()
    yield


app = FastAPI(title="ModooBom Local Agent", version="0.3.0", lifespan=_lifespan)

# 동일 출처가 기본이지만, 배포 웹(github.io)→로컬 에이전트 '브릿지'도 허용(사용자가 LNA 허용 시).
_ALLOWED_ORIGINS = [
    "http://localhost:8000", "http://127.0.0.1:8000",
    "http://localhost:5173", "http://127.0.0.1:5173",
    "https://biocode67.github.io",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _allow_private_network(request, call_next):
    """크롬 Private Network Access 프리플라이트 통과 — Starlette CORS가 400 거부하기 전 가로채 200 처리."""
    origin = request.headers.get("origin")
    if (request.method == "OPTIONS"
            and request.headers.get("access-control-request-private-network") == "true"
            and origin in _ALLOWED_ORIGINS):
        return _Response(status_code=200, headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": request.headers.get("access-control-request-method", "*"),
            "Access-Control-Allow-Headers": request.headers.get("access-control-request-headers", "*"),
            "Access-Control-Allow-Private-Network": "true",
            "Access-Control-Max-Age": "600",
            "Vary": "Origin",
        })
    response = await call_next(request)
    if origin in _ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


# ── 요청 모델 ──
class DocRequest(BaseModel):
    doc_name: str
    user_name: str = "홍길동"
    birth_date: str = ""
    phone: str = ""
    carrier: str = ""
    sido: str = ""
    sigungu: str = ""


class ApplyRequest(BaseModel):
    service_name: str
    user_name: str = "홍길동"
    profile: dict = {}


# ── 상태 ──
@app.get("/api/health")
async def health():
    """로컬 에이전트 상태 — ai는 없음(프론트 클라이언트 엔진), rpa 가용 여부만 보고."""
    from rpa.config import rpa_enabled
    from rpa.manager import capacity
    rpa_on = rpa_enabled()
    return {
        "status": "ok",
        "service": "ModooBom Local Agent",
        "version": "0.3.0",
        "mode": "local-agent",
        "capabilities": {
            "ai": False,
            "rpa": rpa_on,
            "rpa_capacity": capacity() if rpa_on else None,
            "ai_provider": "client-engine",
        },
    }


# ── RPA 서류 발급 ──
@app.get("/api/documents/rpa-supported")
async def rpa_supported_docs():
    from rpa.manager import SUPPORTED_DOC_NAMES
    return {"supported": SUPPORTED_DOC_NAMES}


@app.post("/api/documents/rpa-issue")
async def rpa_issue(req: DocRequest):
    from rpa.manager import start_rpa_task, SUPPORTED_DOC_NAMES, can_accept, get_task
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    if not can_accept():
        raise HTTPException(status_code=503, detail="지금 자동 발급 이용자가 많아요. 잠시 후 다시 시도하거나 공식 사이트에서 바로 발급하실 수 있어요.")
    if req.doc_name not in SUPPORTED_DOC_NAMES:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 서류: {req.doc_name}\n지원 목록: {', '.join(SUPPORTED_DOC_NAMES)}")
    user_info = {"user_name": req.user_name, "birth_date": req.birth_date, "phone": req.phone,
                 "carrier": req.carrier, "sido": req.sido, "sigungu": req.sigungu}
    task_id = start_rpa_task(req.doc_name, req.user_name, user_info)
    _t = get_task(task_id)
    token = getattr(_t, "download_token", "") if _t is not None and not isinstance(_t, dict) else (_t or {}).get("download_token", "")
    return {"task_id": task_id, "download_token": token, "status": "started", "doc_name": req.doc_name}


@app.get("/api/documents/rpa-status/{task_id}")
async def rpa_status(task_id: str):
    from rpa.manager import get_task
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    d = task.to_dict() if hasattr(task, "to_dict") else dict(task)
    d.pop("download_token", None)  # 다운로드 인가 비밀 유출 방지
    return d


@app.get("/api/documents/rpa-file/{task_id}")
async def rpa_file(task_id: str, t: str = ""):
    """발급 완료 문서를 사용자 브라우저로 반환. 시작자만 아는 download_token(?t=) 일치 시에만."""
    from rpa.manager import get_task
    from rpa.base import DOCS_DIR
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    d = task if isinstance(task, dict) else task.to_dict()
    token = d.get("download_token") or ""
    if not t or not token or not hmac.compare_digest(str(t), str(token)):
        raise HTTPException(status_code=403, detail="다운로드 인가 토큰이 필요합니다.")
    result = d.get("result") or {}
    path = result.get("saved_path")
    if d.get("status") not in ("done", "completed") or not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="아직 발급이 완료되지 않았거나 저장된 문서가 없습니다.")
    real = os.path.realpath(path)
    if os.path.commonpath([real, os.path.realpath(str(DOCS_DIR))]) != os.path.realpath(str(DOCS_DIR)):
        raise HTTPException(status_code=403, detail="허용되지 않은 파일 경로입니다.")
    media = "application/pdf" if real.lower().endswith(".pdf") else "image/png"
    return FileResponse(real, media_type=media, filename=os.path.basename(real), headers={
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    })


# ── RPA 복지 신청 ──
@app.get("/api/apply/supported")
async def apply_supported():
    from rpa.manager import SUPPORTED_SERVICE_NAMES
    return {"supported": SUPPORTED_SERVICE_NAMES}


@app.post("/api/apply/start")
async def apply_start(req: ApplyRequest):
    from rpa.manager import start_apply_task, SUPPORTED_SERVICE_NAMES, can_accept
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    if not can_accept():
        raise HTTPException(status_code=503, detail="지금 자동 신청 이용자가 많아요. 잠시 후 다시 시도하거나 공식 사이트에서 바로 신청하실 수 있어요.")
    if req.service_name not in SUPPORTED_SERVICE_NAMES:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 서비스: {req.service_name}\n지원 목록: {', '.join(SUPPORTED_SERVICE_NAMES)}")
    task_id = start_apply_task(req.service_name, req.user_name, req.profile)
    return {"task_id": task_id, "status": "started", "service_name": req.service_name}


@app.get("/api/apply/status/{task_id}")
async def apply_status(task_id: str):
    from rpa.manager import get_task
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    return task.to_dict() if hasattr(task, "to_dict") else task


@app.exception_handler(Exception)
async def _unhandled(request, exc):
    return JSONResponse(status_code=500, content={"detail": "로컬 에이전트에서 문제가 발생했어요. 잠시 후 다시 시도해 주세요."})


# ── 프론트(dist-app) 동일 출처 서빙 — API 라우트 등록 뒤 '/'에 마운트(우선순위 보장) ──
def _find_app_dir() -> Path | None:
    """dist-app 위치 탐색: 번들(_MEIPASS/frontend/dist-app) → 소스(../frontend/dist-app)."""
    for cand in (_BASE / "frontend" / "dist-app", _BASE.parent / "frontend" / "dist-app"):
        if (cand / "index.html").is_file():
            return cand
    return None


_APP_DIR = _find_app_dir()
if _APP_DIR is not None:
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=str(_APP_DIR), html=True), name="local-app")


def _port_in_use(host: str, port: int) -> bool:
    """이미 로컬 에이전트가 떠 있는지(중복 실행 방지·친절 안내용)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        try:
            return s.connect_ex((host if host != "0.0.0.0" else "127.0.0.1", port)) == 0
        except OSError:
            return False


def main():
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")  # 루프백 기본 — 개인정보 다루는 로컬 에이전트를 LAN에 노출 안 함
    port = int(os.getenv("PORT", "8000"))
    os.environ.setdefault("RPA_ENABLED", "1")  # 로컬 설치본은 RPA 활성 기본
    url = f"http://localhost:{port}/"

    # 이미 실행 중이면(더블클릭 두 번 등) 새로 띄우지 않고 기존 창을 브라우저로 연다 → 포트 충돌 스택트레이스 방지.
    if _port_in_use(host, port):
        print(f"[모두봄] 이미 실행 중이에요. 브라우저에서 {url} 을 여세요.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        return

    # 접속 소음 줄이고(warning) 배너는 lifespan에서 출력.
    uvicorn.run(app, host=host, port=port, log_level="warning", access_log=False)


if __name__ == "__main__":  # pragma: no cover
    main()
