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

from fastapi import FastAPI, HTTPException, Request
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


def _set_console_title():
    """콘솔 제목/창을 '모두봄'으로 — 검은 창이 뭔지 몰라 무서운 사용자에게 최소한의 안내."""
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleTitleW("모두봄 — 창을 닫지 마세요 (닫으면 종료돼요)")
        except Exception:
            pass


def _print_banner():
    port = os.getenv("PORT", "8000")
    _set_console_title()
    line = "═" * 56
    print("\n" + line)
    print("  🌱  모두봄이 실행됐어요!")
    print("")
    print(f"  ✅  잠시 후 브라우저가 자동으로 열려요.")
    print(f"      안 열리면 브라우저 주소창에  http://localhost:{port}/  를 입력하세요.")
    print("")
    print("  ⚠️  이 검은 창은 '닫지 마세요'. 여기서 모두봄이 돌아가고 있어요.")
    print("      (다 쓰고 종료하려면 이 창을 닫거나 Ctrl+C 를 누르면 돼요.)")
    print("")
    print(f"  📄  서류 자동발급은 {_detect_browser()} 로 진행돼요. 폰에서 '인증 허용'만 누르면 끝!")
    print(line + "\n", flush=True)


@asynccontextmanager
async def _lifespan(_app):
    _print_banner()
    yield


app = FastAPI(title="ModooBom Local Agent", version="0.3.0", lifespan=_lifespan)

# 동일 출처가 기본이지만, 배포 웹(github.io)→로컬 에이전트 '브릿지'도 허용(사용자가 LNA 허용 시).
# CORS_ORIGINS env(쉼표구분)로 추가 출처 허용 — 자체 도메인·터널·테스트 프론트 포트 등(공개 서버 배포 시 유용).
_ALLOWED_ORIGINS = [
    "http://localhost:8000", "http://127.0.0.1:8000",
    "http://localhost:5173", "http://127.0.0.1:5173",
    "https://biocode67.github.io",
]
_ALLOWED_ORIGINS += [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
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
    auth_provider: str = "kakao"  # 간편인증 수단: kakao|pass|naver|toss (어르신 다수 PASS)


class DemoRequest(BaseModel):
    doc_name: str = "주민등록등본"  # 체험할 서류(안내페이지 없으면 정부24 홈 폴백)


class ApplyRequest(BaseModel):
    service_name: str
    user_name: str = "홍길동"
    profile: dict = {}


class JourneyRunRequest(BaseModel):
    doc_names: list[str] = []
    service_names: list[str] = []
    user_name: str = "홍길동"
    birth_date: str = ""
    phone: str = ""
    carrier: str = ""
    auth_provider: str = "kakao"
    sido: str = ""
    sigungu: str = ""
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


@app.get("/api/_selftest/browser")
async def _selftest_browser():
    """번들된 Playwright 드라이버/브라우저가 '실제로' 뜨는지 확인(패키징 스모크용, 네트워크 무관).

    PyInstaller 번들의 가장 흔한 파손(node 드라이버 경로/브라우저 미탑재)은 health/supported 로는
    못 잡는다(그건 `import playwright` 만으로 통과). 여기서 about:blank 로 한 번 띄워 닫아 실증한다.
    강제 headless(창 안 뜸). 실패 시 500 + 원인(브라우저/드라이버 없음 등)."""
    from rpa.base import launch_browser
    from playwright.async_api import async_playwright
    # ⚠️ 셀프테스트 동안만 headless — 전역 os.environ 을 영구히 바꾸면 이후 '모든' 발급이 보이지 않는 창에서
    #   돌아 카카오 인증 불가·연쇄 타임아웃이 된다(감사 :197). 반드시 원래 값으로 원복한다.
    _prev_headless = os.environ.get("RPA_HEADLESS")
    os.environ["RPA_HEADLESS"] = "1"  # 스모크는 창 없이
    try:
        async with async_playwright() as pw:
            browser = await launch_browser(pw, slow_mo=0)
            page = await browser.new_page()
            await page.goto("about:blank")
            await browser.close()
        return {"ok": True, "browser": os.environ.get("RPA_ACTIVE_BROWSER", "chromium")}
    except Exception as e:  # noqa: BLE001 — 원인을 그대로 반환(드라이버/브라우저 진단용)
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)[:300]})
    finally:
        if _prev_headless is None:
            os.environ.pop("RPA_HEADLESS", None)
        else:
            os.environ["RPA_HEADLESS"] = _prev_headless


# ── RPA 서류 발급 ──
# ⚠️ 유지보수 주의: 아래 RPA/apply 엔드포인트는 api/routes.py 의 동명 핸들러를 '의도적으로 복제'한 것이다.
#   (routes.py 는 상단에서 chromadb/langchain 을 import 해, 경량 로컬 에이전트가 그대로 재사용하면
#    무거운 스택이 딸려와 1초 기동·단일 실행파일 번들이 깨진다.) 보안 로직(다운로드 토큰·경로검사 등)을
#   한쪽만 고치면 드리프트가 생기므로, routes.py 의 RPA 엔드포인트를 바꾸면 여기도 함께 반영할 것.
#   backend 감사가 안정화되면 chromadb 비의존 공유 라우터(api/rpa_routes.py)로 추출해 중복을 없앨 것.
@app.post("/api/session/reset")
async def session_reset():
    """공용 PC '다음 분 상담' 전환 — 발급 서류 폴더의 이전 사용자 PII 문서를 서버에서 삭제.
    (프론트의 localStorage 리셋과 짝. 로컬 앱/서버 RPA 공통.)"""
    from rpa.base import clear_docs_dir
    return {"cleared": clear_docs_dir()}


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
                 "carrier": req.carrier, "sido": req.sido, "sigungu": req.sigungu, "auth_provider": req.auth_provider}
    task_id = start_rpa_task(req.doc_name, req.user_name, user_info)
    _t = get_task(task_id)
    token = getattr(_t, "download_token", "") if _t is not None and not isinstance(_t, dict) else (_t or {}).get("download_token", "")
    return {"task_id": task_id, "download_token": token, "status": "started", "doc_name": req.doc_name}


@app.post("/api/rpa/demo-start")
async def rpa_demo_start(req: DemoRequest):
    """체험 모드 — 개인정보 없이 '실제 정부24 자동조작'을 스크린샷으로 보여주고 인증벽에서 정지.
    방문자(심사위원)가 설정·인증·개인정보 없이 진짜 자동화를 체험(표 유도). 진행/스크린샷은 rpa-status 폴링."""
    from rpa.manager import start_demo_task, can_accept, get_task
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    if not can_accept():
        raise HTTPException(status_code=503, detail="지금 체험 이용자가 많아요. 잠시 후 다시 시도해 주세요.")
    task_id = start_demo_task(req.doc_name)
    _t = get_task(task_id)
    token = getattr(_t, "download_token", "") if _t is not None and not isinstance(_t, dict) else (_t or {}).get("download_token", "")
    return {"task_id": task_id, "download_token": token, "status": "started", "doc_name": req.doc_name, "demo": True}


@app.get("/api/documents/rpa-status/{task_id}")
async def rpa_status(task_id: str, t: str = ""):
    from rpa.manager import get_task, token_ok, redact_status
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    d = task.to_dict() if hasattr(task, "to_dict") else dict(task)
    # 스크린샷·실명·서류종은 시작자 토큰(?t=) 일치 시에만 — routes.py 와 패리티
    return redact_status(d, token_ok(t, d.get("download_token")))


@app.post("/api/documents/rpa-cancel/{task_id}")
async def rpa_cancel(task_id: str):
    """진행 중 발급/신청 자동화를 사용자가 중단 — 멈춘 태스크의 유일한 복구 수단(감사 확정 결함 해소).
    슬롯을 반납해 대기 중인 다음 작업이 곧바로 시작되게 한다."""
    from rpa.manager import request_cancel
    return {"cancelled": request_cancel(task_id)}


@app.get("/api/documents/rpa-file/{task_id}")
async def rpa_file(task_id: str, t: str = ""):
    """발급 완료 문서를 사용자 브라우저로 반환. 시작자만 아는 download_token(?t=) 일치 시에만."""
    from rpa.manager import get_task
    from rpa.base import DOCS_DIR
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    from rpa.manager import token_ok
    d = task if isinstance(task, dict) else task.to_dict()
    if not token_ok(t, d.get("download_token")):
        raise HTTPException(status_code=403, detail="다운로드 인가 토큰이 필요합니다.")
    result = d.get("result") or {}
    path = result.get("saved_path")
    if d.get("status") not in ("done", "completed") or not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="아직 발급이 완료되지 않았거나 저장된 문서가 없습니다.")
    real = os.path.realpath(path)
    docs_root = os.path.realpath(str(DOCS_DIR))
    try:
        outside = os.path.commonpath([real, docs_root]) != docs_root
    except ValueError:
        outside = True  # 다른 드라이브 등 commonpath 불가 → 저장 폴더 밖으로 간주(거절)
    if outside:
        raise HTTPException(status_code=403, detail="허용되지 않은 파일 경로입니다.")
    media = "application/pdf" if real.lower().endswith(".pdf") else "image/png"
    # 서버 RPA 모드: 전송 직후 서버 디스크에서 삭제(PII 무저장) — routes.py 와 패리티. 로컬 앱 기본 꺼짐.
    bg = None
    if os.getenv("RPA_DELETE_AFTER_DOWNLOAD", "0") == "1":
        from starlette.background import BackgroundTask

        def _rm(p=real):
            try:
                os.remove(p)
            except OSError:
                pass
        bg = BackgroundTask(_rm)
    return FileResponse(real, media_type=media, filename=os.path.basename(real), background=bg, headers={
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    })


@app.post("/api/documents/open-folder")
async def open_docs_folder():
    """발급 서류 저장 폴더를 파일 탐색기로 연다 — 데스크탑 앱 전용(이 서버는 사용자 본인 PC에서만 돈다).
    '서류가 어디 저장되는지 모르겠다'는 실사용 피드백 대응: 완료 카드의 [저장 폴더 열기] 버튼이 호출.
    열기 실패(원격 세션 등)여도 path 를 돌려줘 프론트가 경로를 안내할 수 있게 한다."""
    from rpa.base import DOCS_DIR
    path = str(DOCS_DIR)
    try:
        DOCS_DIR.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            os.startfile(path)  # noqa: S606 — 로컬 데스크탑 앱의 의도된 폴더 열기
        else:
            import subprocess
            subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", path])
        return {"opened": True, "path": path}
    except Exception as e:
        return {"opened": False, "path": path, "error": str(e)[:120]}


# 사용자가 직접 가진 서류(임대차계약서·신분증 등 자동발급 불가) 확장자·크기 화이트리스트
_REGISTER_EXT = {".pdf", ".png", ".jpg", ".jpeg"}
_REGISTER_MAX = 15 * 1024 * 1024  # 15MB


@app.post("/api/documents/register")
async def register_document(request: Request):
    """'내 서류함' — 사용자가 이미 가진 서류(임대차계약서·신분증 등, 자동발급 불가)를 등록한다.
    발급 서류 폴더(DOCS_DIR)에 발급물과 '같은 이름 규칙'으로 저장 → 복지 신청의 자동첨부
    (recent_issued_docs)가 이 파일도 찾아 붙일 수 있게 한다. 데스크탑 앱 전용(사용자 본인 PC),
    파일은 서버로 나가지 않고 로컬 폴더에만 저장된다."""
    import pathlib
    from rpa.base import DOCS_DIR, doc_basename
    try:
        form = await request.form()   # multipart — 실행환경엔 python-multipart 설치됨(requirements)
    except Exception:
        raise HTTPException(status_code=400, detail="파일 업로드 형식이 올바르지 않아요.")
    doc_name = str(form.get("doc_name") or "").strip()
    user_name = str(form.get("user_name") or "").strip()
    upload = form.get("file")
    if not doc_name or upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=400, detail="서류명과 파일이 필요해요.")
    ext = pathlib.Path(getattr(upload, "filename", "") or "").suffix.lower()
    if ext not in _REGISTER_EXT:
        raise HTTPException(status_code=400, detail="PDF·PNG·JPG 파일만 등록할 수 있어요.")
    data = await upload.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일이에요.")
    if len(data) > _REGISTER_MAX:
        raise HTTPException(status_code=413, detail="파일이 너무 커요(최대 15MB).")
    try:
        DOCS_DIR.mkdir(parents=True, exist_ok=True)
        # 발급물과 동일한 이름 규칙({서류명}_{이름}_{날짜}.{확장자}) — 자동첨부·목록이 발급물과 똑같이 인식
        out = DOCS_DIR / f"{doc_basename(doc_name, user_name)}{ext}"
        out.write_bytes(data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"저장 실패: {str(e)[:120]}")
    return {"registered": True, "doc_name": doc_name, "saved_path": str(out), "filename": out.name}


# ── RPA 복지 신청 ──
@app.get("/api/apply/supported")
async def apply_supported():
    from rpa.manager import SUPPORTED_SERVICE_NAMES
    return {"supported": SUPPORTED_SERVICE_NAMES}


@app.post("/api/apply/start")
async def apply_start(req: ApplyRequest):
    from rpa.manager import start_apply_task, SUPPORTED_SERVICE_NAMES, can_accept, get_task
    from rpa.apply_rpa import _valid_bokjiro_url
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    if not can_accept():
        raise HTTPException(status_code=503, detail="지금 자동 신청 이용자가 많아요. 잠시 후 다시 시도하거나 공식 사이트에서 바로 신청하실 수 있어요.")
    # 지원 6종이 아니어도, 정책의 복지로 딥링크(profile.apply_url)가 있으면 일반화 신청(확장과 동일).
    has_link = _valid_bokjiro_url((req.profile or {}).get("apply_url") or (req.profile or {}).get("applyUrl"))
    if req.service_name not in SUPPORTED_SERVICE_NAMES and not has_link:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 서비스: {req.service_name}\n지원 목록: {', '.join(SUPPORTED_SERVICE_NAMES)} (또는 복지로 신청 딥링크 필요)")
    task_id = start_apply_task(req.service_name, req.user_name, req.profile)
    # 시작자에게만 토큰 반환(rpa-issue 와 동일) — status 스크린샷 열람 인가용(routes.py 패리티)
    started = get_task(task_id)
    token = (started.get("download_token") if isinstance(started, dict)
             else getattr(started, "download_token", "")) or ""
    return {"task_id": task_id, "status": "started", "service_name": req.service_name, "download_token": token}


@app.get("/api/apply/status/{task_id}")
async def apply_status(task_id: str, t: str = ""):
    from rpa.manager import get_task, token_ok, redact_status
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    d = task.to_dict() if hasattr(task, "to_dict") else dict(task)
    return redact_status(d, token_ok(t, d.get("download_token")))


# ── 복지 여정(연쇄 발급/신청) — '전부 자동발급': 서류들을 한 로그인으로 순차 발급 ──
@app.post("/api/journey/run")
async def journey_run(req: JourneyRunRequest):
    """지정한 서류들을 순차 발급(자동 저장)하고 신청까지 오케스트레이션. 사이트별 카카오 본인인증만 본인."""
    from rpa.orchestrator import start_journey, active_journey_id, get_journey, journey_token
    from rpa.manager import can_accept
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    # 재클릭 중복시작 가드 — 이미 진행 중인 여정이 있으면 새로 겹쳐 시작하지 않고 그것을 반환(감사 :374).
    #   (겹쳐 시작하면 브라우저·슬롯 경합으로 연쇄 정체가 난다.)
    existing = active_journey_id()
    if existing:
        j = get_journey(existing) or {}
        steps = j.get("steps", [])
        return {"journey_id": existing, "status": "already_running", "download_token": journey_token(existing),
                "docs": [s["name"] for s in steps if s.get("kind") == "doc"],
                "services": [s["name"] for s in steps if s.get("kind") == "apply"]}
    if not can_accept():
        raise HTTPException(status_code=503, detail="지금 자동화 이용자가 많아요. 잠시 후 다시 시도하거나 공식 사이트에서 바로 진행하실 수 있어요.")
    user_info = {"user_name": req.user_name, "birth_date": req.birth_date, "phone": req.phone, "carrier": req.carrier, "auth_provider": req.auth_provider,
                 "sido": req.sido, "sigungu": req.sigungu}
    jid, accepted_docs, accepted_svcs = start_journey(req.doc_names, req.service_names, req.user_name, user_info, req.profile)
    return {"journey_id": jid, "status": "started", "download_token": journey_token(jid),
            "docs": accepted_docs, "services": accepted_svcs}


@app.post("/api/journey/cancel/{journey_id}")
async def journey_cancel(journey_id: str):
    """진행 중 여정을 중단 — 현재 단계 RPA를 취소하고 다음 단계 브라우저가 뜨지 않게 한다(멈춤 복구)."""
    from rpa.orchestrator import request_journey_cancel
    return {"cancelled": request_journey_cancel(journey_id)}


@app.get("/api/journey/status/{journey_id}")
async def journey_status(journey_id: str, t: str = ""):
    """여정 진행상황 조회. 스크린샷·실명·저장경로는 시작자 토큰(?t=) 일치 시에만."""
    from rpa.orchestrator import journey_view
    j = journey_view(journey_id, t)
    if j is None:
        raise HTTPException(status_code=404, detail="여정을 찾을 수 없습니다.")
    return j


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


def _open_browser_when_ready(url: str):
    """서버 health가 실제로 뜨면 기본 브라우저로 앱을 연다(최대 ~15초, 안 뜨면 안 엶)."""
    import threading
    import time
    import urllib.request

    def _worker():
        for _ in range(30):
            try:
                urllib.request.urlopen(url + "api/health", timeout=1)
                webbrowser.open(url)
                return
            except Exception:
                time.sleep(0.5)
    threading.Thread(target=_worker, daemon=True).start()


def main(open_browser: bool = True):
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

    # 서버가 뜨면 브라우저 자동 오픈(중복 오픈 방지 위해 여기 한 곳에서만 — agent_entry/bat는 위임).
    if open_browser:
        _open_browser_when_ready(url)
    # 접속 소음 줄이고(warning) 배너는 lifespan에서 출력.
    uvicorn.run(app, host=host, port=port, log_level="warning", access_log=False)


if __name__ == "__main__":  # pragma: no cover
    main()
