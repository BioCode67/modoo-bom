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
from fastapi.responses import FileResponse, JSONResponse, Response
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
    print("  🩺  발급이 잘 안 되면: 화면 상단 [발급 전 점검] → 안 풀리면 [진단 복사]를 개발자에게.")
    print(line + "\n", flush=True)


@asynccontextmanager
async def _lifespan(_app):
    _print_banner()
    yield


_VERSION = "0.3.3"  # 데스크탑 신뢰성 런 — 헬스/스트립/진단이 함께 표시(한 곳만 수정)
app = FastAPI(title="ModooBom Local Agent", version=_VERSION, lifespan=_lifespan)

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
    # 🔒 가족관계증명서(efamily)용 선택 정보 — 발급 자동입력에만 쓰고 서버는 저장·로그하지 않는다.
    rrn_back: str = ""       # 주민등록번호 뒷 7자리(선택 — 있으면 efamily 인증 요청까지 자동)
    parent_kind: str = "부"  # 추가정보확인 종류: 부|모
    parent_name: str = ""    # 부 또는 모 성명(선택)


class DemoRequest(BaseModel):
    doc_name: str = "주민등록등본"  # 체험할 서류(안내페이지 없으면 정부24 홈 폴백)


class ProbeRequest(BaseModel):
    doc_name: str = ""          # 자동발급 지원을 실측 확인할 서류 이름(정부24 검색어)
    doc_names: list[str] = []   # 일괄 실측(후보 칩 '전부 확인') — 최대 12종, 한 브라우저로 순회


class ApplyProbeRequest(BaseModel):
    service_name: str  # 자동신청 후보를 실측 확인할 복지 서비스 이름(복지로 검색어)


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
    # 🔒 가족관계증명서(efamily)용 — DocRequest와 동일(저장·로그 금지, 자동입력 전용)
    rrn_back: str = ""
    parent_kind: str = "부"
    parent_name: str = ""


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
        "version": _VERSION,
        "mode": "local-agent",
        "capabilities": {
            "ai": False,
            "rpa": rpa_on,
            "rpa_capacity": capacity() if rpa_on else None,
            "ai_provider": "client-engine",
            # 🔒 공유(터널) 배포 여부 — 프론트가 서류함/점검 등 '본인 PC 전용' UI를 스스로 숨기게(403 충돌 방지).
            #   동일출처로 터널을 직접 여는 경우 rpaRemote 감지가 없어 이 플래그가 유일한 신호다.
            "shared": os.getenv("RPA_SHARED", "").strip().lower() in ("1", "true", "yes"),
            # 🎬 흐름 기록 모드(RPA_FLOW_RECORD=1 — run-local-app.bat 가 자동으로 켬)에서만 true — 프론트가
            #   [🎬 흐름 기록 복사] 버튼을 이때만 노출(설치 EXE는 미설정 → 심사위원에겐 안 보임).
            "flow_record": os.getenv("RPA_FLOW_RECORD", "").strip().lower() in ("1", "true", "on", "yes"),
        },
    }


async def _browser_probe() -> tuple[bool, str]:
    """번들된 Playwright 드라이버/브라우저가 '실제로' 뜨는지 확인(네트워크 무관) — 셀프테스트·프리플라이트 공용.

    PyInstaller 번들의 가장 흔한 파손(node 드라이버 경로/브라우저 미탑재)은 health/supported 로는
    못 잡는다(그건 `import playwright` 만으로 통과). 여기서 about:blank 로 한 번 띄워 닫아 실증한다.
    반환: (성공 여부, 성공 시 브라우저 이름 / 실패 시 원인)."""
    from rpa.base import launch_browser
    from playwright.async_api import async_playwright
    # 점검은 창 없이 — 전역 env(RPA_HEADLESS)를 잠깐 바꾸는 옛 방식은 그 몇 초 사이에 시작된
    # '실제 발급'까지 헤드리스로 띄워 카카오 인증이 불가능해지는 레이스가 있었다(진행 중 점검 클릭 등).
    # launch_browser 의 명시 headless 인자만 사용해 다른 실행에 영향을 주지 않는다.
    try:
        async with async_playwright() as pw:
            browser = await launch_browser(pw, slow_mo=0, headless=True)
            page = await browser.new_page()
            await page.goto("about:blank")
            await browser.close()
        return True, os.environ.get("RPA_ACTIVE_BROWSER", "chromium")
    except Exception as e:  # noqa: BLE001 — 원인을 그대로 반환(드라이버/브라우저 진단용)
        return False, str(e)[:300]


@app.get("/api/_selftest/browser")
async def _selftest_browser():
    """브라우저 단독 셀프테스트(패키징 스모크용). 실패 시 500 + 원인.
    🔒 공유 배포에선 차단 — 발급 슬롯을 우회한 무제한 브라우저 기동(자원 소모) 방지."""
    _shared_mode_guard()
    ok, detail = await _browser_probe()
    if ok:
        return {"ok": True, "browser": detail}
    return JSONResponse(status_code=500, content={"ok": False, "error": detail})


def _probe_site(url: str, timeout: float = 6.0) -> tuple[bool, str]:
    """정부 사이트 연결 확인 — 어떤 HTTP 응답이든(403 포함) '서버가 응답함=연결 OK',
    네트워크 오류(타임아웃·DNS·차단)만 실패로 본다. 발표장 회선이 정부망을 막는 경우를 미리 잡는 용도."""
    import time as _time
    import urllib.error
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    t0 = _time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read(1)
            return True, f"응답 {r.status} · {_time.monotonic() - t0:.1f}초"
    except urllib.error.HTTPError as e:
        return True, f"응답 {e.code} · {_time.monotonic() - t0:.1f}초"
    except Exception as e:  # noqa: BLE001
        return False, str(e)[:120]


@app.get("/api/_preflight")
async def preflight():
    """🩺 발급 전 원버튼 점검 — 데모 런북의 '발표 직전 리허설'을 자동화한다.

    항목: ① 자동화 브라우저 기동 ② 정부24 연결 ③ 복지로 연결 ④ 발급 폴더 쓰기 ⑤ 디스크 여유.
    일부가 실패해도 200 + 정직한 항목별 결과(발표 전에 뭐가 문제인지 한눈에).
    PII 무포함: 폴더는 이름만(홈 경로의 사용자명 미노출), 실명·서류명 없음.
    🔒 공유 배포에선 차단(셀프테스트와 동일 — 슬롯 우회 브라우저 기동 방지)."""
    _shared_mode_guard()
    import asyncio
    import shutil
    from rpa.base import DOCS_DIR

    def docs_check() -> dict:
        try:
            DOCS_DIR.mkdir(parents=True, exist_ok=True)
            probe = DOCS_DIR / ".preflight-probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
            return {"id": "docs_dir", "name": "발급 폴더 쓰기", "ok": True, "detail": DOCS_DIR.name}
        except Exception as e:  # noqa: BLE001
            return {"id": "docs_dir", "name": "발급 폴더 쓰기", "ok": False, "detail": str(e)[:120]}

    def disk_check() -> dict:
        try:
            root = DOCS_DIR if DOCS_DIR.is_dir() else Path.home()
            free = shutil.disk_usage(str(root)).free
            # 발급 PDF는 수백 KB 수준 — 200MB 미만이면 저장 실패가 임박한 상태로 경고
            return {"id": "disk", "name": "디스크 여유", "ok": free > 200 * 1024 * 1024,
                    "detail": f"{free / (1024 ** 3):.1f}GB"}
        except Exception as e:  # noqa: BLE001
            return {"id": "disk", "name": "디스크 여유", "ok": False, "detail": str(e)[:120]}

    sites = [("gov24", "정부24 연결", "https://www.gov.kr"),
             ("bokjiro", "복지로 연결", "https://www.bokjiro.go.kr")]
    results = await asyncio.gather(
        _browser_probe(), *[asyncio.to_thread(_probe_site, url) for _, _, url in sites])
    b_ok, b_detail = results[0]
    checks = [{"id": "browser", "name": "자동화 브라우저", "ok": b_ok, "detail": b_detail}]
    for (sid, name, _url), (ok, detail) in zip(sites, results[1:]):
        checks.append({"id": sid, "name": name, "ok": ok, "detail": detail})
    def vault_check() -> dict:
        """⑥ 서류함 무결성 — 손상(잘림·헤더 불일치) 파일 수를 발급 전에 알려 조치 유도.
        손상이 발급 자체를 막진 않지만 '점검'의 목적상 조치 필요 신호이므로 ok=False로 정직 표기."""
        try:
            items = _scan_documents()
            if not items:
                return {"id": "vault", "name": "서류함 무결성", "ok": True, "detail": "비어 있음"}
            bad = sum(1 for i in items if not i.get("intact", True))
            if bad:
                return {"id": "vault", "name": "서류함 무결성", "ok": False,
                        "detail": f"{len(items)}건 중 손상 {bad}건 — 서류함의 ⚠️ 표시분을 삭제 후 다시 발급하세요"}
            return {"id": "vault", "name": "서류함 무결성", "ok": True, "detail": f"{len(items)}건 전부 정상"}
        except Exception:  # noqa: BLE001
            return {"id": "vault", "name": "서류함 무결성", "ok": True, "detail": "확인 불가"}

    checks.append(docs_check())
    checks.append(disk_check())
    checks.append(vault_check())
    return {"ok": all(c["ok"] for c in checks), "checks": checks}


@app.get("/api/_diag")
async def diagnostics():
    """원클릭 진단 — 발급 실패 시 사용자가 개발자에게 붙여넣을 수 있는 기술 정보(확장의 '진단 복사'와 대칭).
    ⚠️ PII 무포함 원칙: 실명·서류명·스크린샷·토큰은 절대 싣지 않는다(상태 redaction 하우스 규칙과 동일).
    태스크는 상태별 '개수'와 최근 오류의 기술 문구(잘라냄)만."""
    import platform
    import sys as _sys
    from rpa.manager import _rpa_tasks, _MAX_CONCURRENT, _active, _waiting, _strip_pii_lines, SUPPORTED_DOC_NAMES
    from rpa.base import DOCS_DIR
    from rpa.config import rpa_enabled
    from rpa.gov24_rpa import EXTRA_DOC_NAMES
    counts: dict = {}
    last_error = ""
    try:
        for t in list(_rpa_tasks.values()):
            d = t if isinstance(t, dict) else t.to_dict()
            st = str(d.get("status") or "?")
            counts[st] = counts.get(st, 0) + 1
            if st == "error":
                # 기술 오류 문구만(발급 실패 원인) — 실명 줄·저장경로 줄을 제거하고(공용 _strip_pii_lines),
                #   오류문에 섞인 민감 서류종(장애인·한부모 등)까지 '(서류)'로 가린 뒤 200자로 제한한다.
                #   (공용 PC '다음 분 상담'·터널 배포에서 남의 서류종이 진단으로 새던 실결함 — 감사 확정)
                _e = _strip_pii_lines(str(d.get("current_step") or ""))
                for _dn in SUPPORTED_DOC_NAMES:
                    if _dn and _dn in _e:
                        _e = _e.replace(_dn, "(서류)")
                last_error = _e[:200]
    except Exception:
        pass
    docs_count = 0
    try:
        if DOCS_DIR.is_dir():
            docs_count = sum(1 for p in DOCS_DIR.iterdir() if p.is_file())
    except Exception:
        pass
    try:
        import playwright  # noqa: F401
        pw = getattr(playwright, "__version__", "installed")
    except Exception:
        pw = "missing"
    return {
        "version": _VERSION,
        "platform": f"{platform.system()} {platform.release()}",
        "python": _sys.version.split()[0],
        "playwright": pw,
        "rpa_enabled": rpa_enabled(),
        "browser_channel_env": os.getenv("RPA_BROWSER_CHANNEL", "(auto)"),
        "active_browser": os.getenv("RPA_ACTIVE_BROWSER", "(not launched yet)"),
        "capacity": {"max": _MAX_CONCURRENT, "active": _active, "waiting": _waiting},
        "tasks_by_status": counts,
        "last_error": last_error,
        "docs_dir_exists": DOCS_DIR.is_dir(),
        "docs_file_count": docs_count,
        # 동적 확장·무결성 현황(개수만 — PII 무포함 원칙 유지): 원격 지원 시 '확장이 붙었는지/손상물이
        # 있는지'를 진단 한 번으로 파악. corrupt는 서류함 관리 대상 확장자만 계산.
        "extra_docs_count": len(EXTRA_DOC_NAMES),
        "docs_corrupt_count": sum(1 for i in _scan_documents() if not i.get("intact", True)),
    }


@app.get("/api/_diagnostics/latest")
async def latest_diagnostic():
    """가장 최근 저장된 '실패 자가 진단'(실화면 구조·PII 없음)을 반환 — 프론트 [🔬 진단 복사]가 이 하나를
    개발자에게 전달하면, 접속 못 하는 실화면 구조를 정확히 파악해 고칠 수 있다. 스크린샷 반복을 대체한다.
    🔒 본인 PC 전용(공유 배포 403). 값(이름·주민번호 등)은 애초에 담기지 않는다(diagnostics 모듈 계약)."""
    _shared_mode_guard()
    import glob as _glob
    import json as _json
    from rpa.base import DOCS_DIR
    ddir = os.path.join(str(DOCS_DIR), "_diagnostics")
    try:
        files = sorted(_glob.glob(os.path.join(ddir, "*.json")), key=os.path.getmtime, reverse=True)
    except Exception:
        files = []
    if not files:
        return {"available": False}
    try:
        data = _json.loads(open(files[0], encoding="utf-8").read())
        return {"available": True, "file": os.path.basename(files[0]), "count": len(files), "diagnostic": data}
    except Exception as e:
        return {"available": False, "error": str(e)[:120]}


@app.get("/api/_diagnostics/flow")
async def flow_record():
    """🎬 이번 실행이 '지나간 화면들'의 구조(값 없음)를 한 번에 반환 — RPA_FLOW_RECORD=1(run-local-app.bat
    자동 켬)일 때만 쌓인다. 프론트 [🎬 흐름 기록 복사]가 이 하나를 개발자에게 전달하면, 성공하며 지나가는
    '다음 화면·새 팝업'까지 스크린샷 없이 한 번에 파악해 전 단계를 함께 고칠 수 있다(단계별 촬영을 대체).
    🔒 본인 PC 전용(공유 배포 403)·값 미수집(diagnostics 모듈 계약)."""
    _shared_mode_guard()
    from rpa import diagnostics as _dg
    return _dg.read_flow()


# ── RPA 서류 발급 ──
# ⚠️ 유지보수 주의: 아래 RPA/apply 엔드포인트는 api/routes.py 의 동명 핸들러를 '의도적으로 복제'한 것이다.
#   (routes.py 는 상단에서 chromadb/langchain 을 import 해, 경량 로컬 에이전트가 그대로 재사용하면
#    무거운 스택이 딸려와 1초 기동·단일 실행파일 번들이 깨진다.) 보안 로직(다운로드 토큰·경로검사 등)을
#   한쪽만 고치면 드리프트가 생기므로, routes.py 의 RPA 엔드포인트를 바꾸면 여기도 함께 반영할 것.
#   backend 감사가 안정화되면 chromadb 비의존 공유 라우터(api/rpa_routes.py)로 추출해 중복을 없앨 것.
@app.post("/api/session/reset")
async def session_reset():
    """공용 PC '다음 분 상담' 전환 — 발급 서류 폴더의 이전 사용자 PII 문서를 서버에서 삭제.
    (프론트의 localStorage 리셋과 짝. 로컬 앱/서버 RPA 공통.)
    🔒 공유(터널) 배포에선 차단 — 다른 이용자가 방금 발급한 서류를 통째로 지울 수 있는 파괴적 호출."""
    _shared_mode_guard()
    from rpa.base import clear_docs_dir
    return {"cleared": clear_docs_dir()}


@app.get("/api/documents/rpa-supported")
async def rpa_supported_docs():
    # beta = 프로브 실측(--register)으로 확장된 동적 서류 — 첫 실발급이 최종 검증(β 배지, routes 파리티)
    from rpa.manager import SUPPORTED_DOC_NAMES
    from rpa.gov24_rpa import EXTRA_DOC_NAMES
    return {"supported": SUPPORTED_DOC_NAMES, "beta": EXTRA_DOC_NAMES}


# 앱 내 커버리지 실측 확인은 한 번에 하나만(브라우저 1개, 정부24 예의) — 동시 클릭 방지 락
_probe_busy = {"on": False}


@app.post("/api/docs/probe")
async def docs_probe(req: ProbeRequest):
    """🔎 자동발급 지원 실측 확인 — 서류명 하나로 정부24를 실제 조사해(검색→코드 발굴→발급버튼 확인)
    통과분만 β 등록하고 **재시작 없이** 발급 목록에 반영한다(모든 서류 자동발급의 정직한 확장 경로).

    날조 금지: 실측 실패·비대상은 그대로 보고(추측 등재 없음). 결과가 ok여도 β — 첫 실발급이 최종 검증.
    🔒 본인 PC 전용(공유 배포 403) · 프로브는 검색·안내 페이지만 열람(로그인·개인정보 불필요)."""
    _shared_mode_guard()
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    raw = req.doc_names if req.doc_names else [req.doc_name]
    names = [str(n or "").strip() for n in raw]
    names = [n for n in names if n]
    if not names or any(len(n) > 40 for n in names) or len(names) > 12:
        raise HTTPException(status_code=400, detail="서류 이름을 1~40자, 최대 12종까지 입력해 주세요.")
    from rpa.manager import SUPPORTED_DOC_NAMES
    todo = [n for n in names if n not in SUPPORTED_DOC_NAMES]  # 기지원분은 브라우저를 띄우지 않음
    if not todo:
        return {"status": "already", "message": f"「{names[0]}」{' 등은' if len(names) > 1 else '는'} 이미 자동발급을 지원해요."}
    if _probe_busy["on"]:
        raise HTTPException(status_code=409, detail="이미 다른 실측 확인이 진행 중이에요 — 잠시 후 다시 시도해 주세요.")
    _probe_busy["on"] = True
    try:
        import asyncio as _aio
        from rpa.probe import probe_and_register
        # 브라우저 조사 ~30초/종 — 스레드로 옮겨 이벤트 루프(발급 폴링 등)를 막지 않는다
        return await _aio.to_thread(probe_and_register, todo)
    finally:
        _probe_busy["on"] = False


@app.get("/api/docs/probe-candidates")
async def docs_probe_candidates():
    """실측 후보 칩 — 기본 후보 중 '아직 미지원'인 것만(카탈로그 빈도 기반, 추측 등재 아님 — 실측 대상일 뿐)."""
    from rpa.probe import DEFAULT_DOC_CANDIDATES
    from rpa.manager import SUPPORTED_DOC_NAMES
    return {"candidates": [n for n in DEFAULT_DOC_CANDIDATES if n not in SUPPORTED_DOC_NAMES]}


@app.post("/api/apply/probe")
async def apply_probe(req: ApplyProbeRequest):
    """🔎 자동신청 후보 실측 확인 — 복지로에서 서비스명→wlfareInfoId를 실측 발굴하고 상세 일치까지 확인.

    정직성(중요): 복지로는 비로그인 시 방문형에도 '신청하기'를 렌더하므로 여기선 '후보(candidate)'까지만 —
    온라인 신청형인지는 첫 자동신청 실행이 판별한다(버튼 없으면 apply_rpa가 정직한 실패 + 공식 링크 폴백).
    매핑은 클라이언트(이 PC 브라우저)에만 기억되고, 서버 신청 경로는 기존 복지로 URL 검증 게이트를 그대로 탄다.
    🔒 본인 PC 전용(공유 배포 403) · 조사에는 로그인·개인정보 불필요."""
    _shared_mode_guard()
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    name = (req.service_name or "").strip()
    if not name or len(name) > 60:
        raise HTTPException(status_code=400, detail="서비스 이름을 1~60자로 입력해 주세요.")
    if _probe_busy["on"]:
        raise HTTPException(status_code=409, detail="이미 다른 실측 확인이 진행 중이에요 — 잠시 후 다시 시도해 주세요.")
    _probe_busy["on"] = True
    try:
        import asyncio as _aio
        from rpa.probe import probe_apply_names
        rows, err = await _aio.to_thread(probe_apply_names, [name])
        if err:
            return {"status": "error", "message": err}
        r = rows[0] if rows else {}
        if str(r.get("verdict", "")).startswith("🟡"):
            return {"status": "candidate", "name": name, "wlfareInfoId": r.get("id", ""),
                    "url": r.get("url", ""), "title": r.get("title", ""),
                    "message": "복지로 등재·서비스 일치를 확인했어요(β) — 온라인 신청형인지는 첫 자동신청에서 확인돼요."}
        return {"status": "not_found", "name": name,
                "note": r.get("note", "") or r.get("verdict", ""),
                "message": f"복지로에서 「{name}」의 신청 상세를 확정하지 못했어요 — 공식 링크로 신청을 안내해 드려요."}
    finally:
        _probe_busy["on"] = False


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
                 "carrier": req.carrier, "sido": req.sido, "sigungu": req.sigungu, "auth_provider": req.auth_provider,
                 "rrn_back": req.rrn_back, "parent_kind": req.parent_kind, "parent_name": req.parent_name}
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


def _shared_mode_guard():
    """🔒 공유(터널/원격) 배포 가드 — RPA_SHARED=1 이면 '내 서류함' 계열(목록·삭제·등록·폴더열기)을 차단.

    이 엔드포인트들은 '사용자 본인 PC에서만 도는' 전제의 무토큰 설계다. 심사용 터널/원격 서버처럼
    여러 사람이 같은 서버를 쓰면 서로의 서류 표시명(실명 포함)을 보거나 남의 파일을 지울 수 있다.
    → 공유 배포 시 운영자가 RPA_SHARED=1 을 설정해 이 계열을 통째로 끈다(발급·신청 RPA는 그대로)."""
    if os.getenv("RPA_SHARED", "").strip().lower() in ("1", "true", "yes"):
        raise HTTPException(status_code=403, detail="공유 서버에서는 서류함 기능을 제공하지 않아요(개인정보 보호).")


@app.post("/api/documents/open-folder")
async def open_docs_folder():
    """발급 서류 저장 폴더를 파일 탐색기로 연다 — 데스크탑 앱 전용(이 서버는 사용자 본인 PC에서만 돈다).
    '서류가 어디 저장되는지 모르겠다'는 실사용 피드백 대응: 완료 카드의 [저장 폴더 열기] 버튼이 호출.
    열기 실패(원격 세션 등)여도 path 를 돌려줘 프론트가 경로를 안내할 수 있게 한다."""
    _shared_mode_guard()
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
    _shared_mode_guard()
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


# 서류함 목록/삭제가 다루는 확장자 — 발급물(PDF/PNG)+등록물(JPG). 그 외 파일은 목록·삭제 대상에서 제외(안전).
_DOCS_EXT = {".pdf", ".png", ".jpg", ".jpeg"}


@app.get("/api/documents/list")
async def list_documents():
    """🗂 내 서류함 — 발급/등록된 서류 목록(사용자 본인 PC 폴더). 표시이름·크기·시각과 함께
    '지금 신청하면 자동첨부 후보인지'(attach_candidate)를 서버 기준(RPA_ATTACH_MAX_AGE)으로 알려줘
    프론트와 자동첨부 판정이 어긋나지 않게 한다(단일 소스). 같은 PC 사용자 본인용 정보라
    open-folder/register 와 동일한 무토큰·CORS 게이트 정책을 따른다."""
    _shared_mode_guard()
    items = _scan_documents()
    attach_age = int(os.getenv("RPA_ATTACH_MAX_AGE", "1200"))
    from rpa.base import DOCS_DIR
    return {"documents": items, "attach_window_sec": attach_age, "folder": str(DOCS_DIR)}


def _scan_documents():
    """서류함 폴더 스캔 — 목록/번들(ZIP)이 공유하는 단일 스캐너.

    항목별로 표시명 외에 '서류 관리 지능' 필드를 계산한다:
      · doc_type  : 표시명에서 사람 이름을 뗀 서류 종류('주민등록등본_홍길동' → '주민등록등본')
      · age_days  : 발급/등록 후 경과일
      · validity  : 발급형 증명서(자동발급 15종)에만 통용 유효 상태 —
                    관공서 제출용 증명서는 통상 '발급일로부터 3개월 이내'를 요구한다(기관별 상이).
                    fresh(≤60일)·aging(61~90일, 확인 권장)·stale(>90일, 재발급 권장).
                    임대차계약서·신분증 등 본인 소지 서류는 만료 개념이 달라 None(표시 안 함 — 오표시 방지).
    """
    import time as _time
    import re as _re
    from rpa.base import DOCS_DIR
    from rpa.manager import SUPPORTED_DOC_NAMES
    attach_age = int(os.getenv("RPA_ATTACH_MAX_AGE", "1200"))
    now = _time.time()
    items = []
    try:
        if DOCS_DIR.is_dir():
            for p in DOCS_DIR.iterdir():
                if not p.is_file() or p.suffix.lower() not in _DOCS_EXT:
                    continue
                st = p.stat()
                stem = p.stem
                # 표시명: 신형 '_YYYY-MM-DD_HHMM(_SS)' / 구형 '_YYYYMMDD_HHMMSS' 접미 제거(recent_issued_docs 와 동일 규칙)
                display = _re.sub(r"(_\d{4}-\d{2}-\d{2}_\d{4}(_\d{2})?|_\d{8}_\d{6})$", "", stem) or stem
                # 서류 종류 — '{서류명}_{이름}'에서 이름 접미 제거(서류명 자체는 '_'를 쓰지 않는 명명 규칙)
                doc_type = display.split("_")[0] if "_" in display else display
                age_days = int((now - st.st_mtime) // 86400)
                if doc_type in SUPPORTED_DOC_NAMES:
                    validity = "fresh" if age_days <= 60 else ("aging" if age_days <= 90 else "stale")
                else:
                    validity = None
                # 무결성 — 헤더·최소크기 게이트(발급 성공 게이트와 동일 기준). 깨진 파일은
                # ⚠️ 표시 대상이며 '자동첨부 후보'에서도 제외한다(손상물이 조용히 제출되는 것 방지).
                from rpa.base import _looks_valid_doc
                intact = _looks_valid_doc(p)
                items.append({
                    "filename": p.name,
                    "display": display,
                    "doc_type": doc_type,
                    "ext": p.suffix.lower().lstrip("."),
                    "size": st.st_size,
                    "mtime": int(st.st_mtime),
                    "age_days": age_days,
                    "validity": validity,
                    "intact": intact,
                    "attach_candidate": intact and (now - st.st_mtime) <= attach_age,
                })
    except Exception:
        pass  # 폴더 접근 실패 시 빈 목록(정직한 폴백 — 프론트는 '폴더 열기'로 유도)
    items.sort(key=lambda x: x["mtime"], reverse=True)
    return items


@app.post("/api/documents/bundle")
async def bundle_documents(request: Request):
    """📦 신청 서류 묶음(ZIP) — 요청한 서류 종류별 '최신 파일 1건'씩 골라 ZIP으로 내려준다.

    쓰임: 복지로/주민센터 제출·이메일 첨부처럼 '흩어진 발급물을 한 번에' 옮겨야 할 때.
    docs 를 비우면 서류함 전체(종류별 최신 1건). label 은 ZIP 파일명 표기용(정책명 등).
    응답 헤더 X-Bundle-Matched / X-Bundle-Missing 으로 몇 종이 담겼고 몇 종이 없는지
    정직하게 알린다(없는 서류를 담은 척하지 않는다). 데스크탑 앱 전용(_shared_mode_guard)."""
    _shared_mode_guard()
    import io
    import re as _re
    import zipfile
    from datetime import datetime
    from rpa.base import DOCS_DIR
    try:
        body = await request.json()
    except Exception:
        body = {}
    want = [str(d).strip() for d in (body or {}).get("docs") or [] if str(d).strip()]
    label = _re.sub(r"[^0-9A-Za-z가-힣 _-]", "", str((body or {}).get("label") or "")).strip()[:40]
    items = _scan_documents()
    # 종류별 최신 1건(스캔 결과는 이미 최신순) — 같은 서류를 여러 번 발급했어도 최신본만 담는다
    latest_by_type = {}
    for it in items:
        latest_by_type.setdefault(it["doc_type"], it)
    if want:
        matched = [latest_by_type[d] for d in want if d in latest_by_type]
        missing = [d for d in want if d not in latest_by_type]
    else:
        matched = list(latest_by_type.values())
        missing = []
    if not matched:
        raise HTTPException(status_code=404, detail="묶을 서류가 없어요 — 먼저 발급하거나 서류함에 등록해 주세요.")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for it in matched:
            try:
                z.write(str(DOCS_DIR / it["filename"]), arcname=it["filename"])
            except OSError:
                missing.append(it["doc_type"])  # 목록엔 있었는데 읽기 실패 — 숨기지 않고 누락으로 보고
    buf.seek(0)
    stamp = datetime.now().strftime("%Y-%m-%d")
    zip_name = f"신청서류_{label + '_' if label else ''}{stamp}.zip"
    from urllib.parse import quote
    return Response(content=buf.getvalue(), media_type="application/zip", headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(zip_name)}",
        "Cache-Control": "no-store",
        "X-Bundle-Matched": str(len(matched)),
        "X-Bundle-Missing": quote(",".join(dict.fromkeys(missing))),
    })


@app.post("/api/documents/delete")
async def delete_document(request: Request):
    """서류함 파일 삭제 — 잘못 등록/발급한 서류를 앱에서 바로 지운다(PII 정리).
    파일명(베이스네임)만 받으며, 실제 경로가 서류 폴더 안인지 재검증(rpa-file 과 동일한 이탈 방지)."""
    _shared_mode_guard()
    from rpa.base import DOCS_DIR
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="요청 형식이 올바르지 않아요.")
    filename = str((body or {}).get("filename") or "").strip()
    # 베이스네임만 허용 — 경로 구분자·상위 이동이 섞이면 즉시 거절
    if not filename or filename != os.path.basename(filename) or filename.startswith(".") or ".." in filename:
        raise HTTPException(status_code=400, detail="올바르지 않은 파일명이에요.")
    if os.path.splitext(filename)[1].lower() not in _DOCS_EXT:
        raise HTTPException(status_code=400, detail="서류함이 관리하는 파일이 아니에요.")
    target = os.path.realpath(str(DOCS_DIR / filename))
    docs_root = os.path.realpath(str(DOCS_DIR))
    try:
        outside = os.path.commonpath([target, docs_root]) != docs_root
    except ValueError:
        outside = True
    if outside:
        raise HTTPException(status_code=403, detail="허용되지 않은 파일 경로입니다.")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="파일이 이미 없거나 찾을 수 없어요.")
    try:
        os.remove(target)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"삭제 실패: {str(e)[:120]}")
    return {"deleted": True, "filename": filename}


_DOC_MEDIA = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


@app.get("/api/documents/file")
async def view_document_file(name: str = ""):
    """🗂 서류함 파일 열람 — 발급물·등록물을 제출 전에 앱에서 바로 눈으로 확인(새 탭 인라인).
    본인 PC 전용(_shared_mode_guard) + delete 와 동일한 베이스네임·realpath 이탈 방지 가드."""
    _shared_mode_guard()
    from rpa.base import DOCS_DIR
    filename = str(name or "").strip()
    if not filename or filename != os.path.basename(filename) or filename.startswith(".") or ".." in filename:
        raise HTTPException(status_code=400, detail="올바르지 않은 파일명이에요.")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in _DOCS_EXT:
        raise HTTPException(status_code=400, detail="서류함이 관리하는 파일이 아니에요.")
    target = os.path.realpath(str(DOCS_DIR / filename))
    docs_root = os.path.realpath(str(DOCS_DIR))
    try:
        outside = os.path.commonpath([target, docs_root]) != docs_root
    except ValueError:
        outside = True
    if outside:
        raise HTTPException(status_code=403, detail="허용되지 않은 파일 경로입니다.")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없어요.")
    from urllib.parse import quote
    return FileResponse(target, media_type=_DOC_MEDIA.get(ext, "application/octet-stream"),
                        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}"})


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
        # 🔒 공유(터널) 배포에선 남의 여정 토큰/ID를 절대 돌려주지 않는다 — download_token이 있으면
        #   다른 이용자의 정부 페이지 스크린샷(주민번호 가능)·저장 경로 열람과 여정 취소/스킵까지 가능해진다.
        if os.getenv("RPA_SHARED", "").strip().lower() in ("1", "true", "yes"):
            raise HTTPException(status_code=503, detail="지금 다른 이용자의 연쇄 자동발급이 진행 중이에요 — 잠시 후 다시 시도해 주세요.")
        j = get_journey(existing) or {}
        steps = j.get("steps", [])
        return {"journey_id": existing, "status": "already_running", "download_token": journey_token(existing),
                "docs": [s["name"] for s in steps if s.get("kind") == "doc"],
                "services": [s["name"] for s in steps if s.get("kind") == "apply"]}
    if not can_accept():
        raise HTTPException(status_code=503, detail="지금 자동화 이용자가 많아요. 잠시 후 다시 시도하거나 공식 사이트에서 바로 진행하실 수 있어요.")
    user_info = {"user_name": req.user_name, "birth_date": req.birth_date, "phone": req.phone, "carrier": req.carrier, "auth_provider": req.auth_provider,
                 "sido": req.sido, "sigungu": req.sigungu,
                 "rrn_back": req.rrn_back, "parent_kind": req.parent_kind, "parent_name": req.parent_name}
    jid, accepted_docs, accepted_svcs = start_journey(req.doc_names, req.service_names, req.user_name, user_info, req.profile)
    return {"journey_id": jid, "status": "started", "download_token": journey_token(jid),
            "docs": accepted_docs, "services": accepted_svcs}


@app.post("/api/journey/skip/{journey_id}")
async def journey_skip(journey_id: str):
    """연쇄 여정의 '현재 단계만' 건너뛰기 — 이 단계 RPA를 접고 다음 단계로 계속(전체 중단과 구분)."""
    from rpa.orchestrator import request_journey_skip
    return {"skipped": request_journey_skip(journey_id)}


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
    # ⚠️ 최외곽 예외 핸들러 응답은 CORSMiddleware를 거치지 않아 CORS 헤더가 없다 — gh-pages→로컬 에이전트
    #   브릿지에서 미처리 500이 나면 브라우저가 응답을 차단해 프론트가 detail(안내 문구)을 못 읽고 네트워크
    #   오류(failStreak)로만 처리하던 갭(감사 확정). 허용 오리진이면 CORS 헤더를 실어 프론트가 문구를 읽게 한다.
    origin = request.headers.get("origin")
    headers = {}
    if origin in _ALLOWED_ORIGINS:
        headers = {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin"}
    return JSONResponse(status_code=500,
                        content={"detail": "로컬 에이전트에서 문제가 발생했어요. 잠시 후 다시 시도해 주세요."},
                        headers=headers)


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

    class _AppStatic(StaticFiles):
        """dist-app 서빙 + 명시 캐시 정책 — stale 흰 화면 방지.

        run-local-app.bat 이 git pull 후 dist-app 을 재빌드해도, 브라우저가 '휴리스틱 캐시'로
        옛 index.html 을 재검증 없이 쓰면 이미 삭제된 옛 해시 자산을 참조해 흰 화면이 된다.
        → index.html 등 비해시 파일은 no-cache(매번 재검증 — ETag 304라 여전히 빠름),
          /assets/ 해시 파일은 immutable 영구 캐시(내용이 바뀌면 파일명이 바뀜)."""
        def file_response(self, *args, **kwargs):  # type: ignore[override]
            resp = super().file_response(*args, **kwargs)
            p = str(getattr(resp, "path", "") or "").replace("\\", "/")
            if "/assets/" in p:
                resp.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
            else:
                resp.headers["Cache-Control"] = "no-cache"
            return resp

    app.mount("/", _AppStatic(directory=str(_APP_DIR), html=True), name="local-app")


def _port_in_use(host: str, port: int) -> bool:
    """이미 로컬 에이전트가 떠 있는지(중복 실행 방지·친절 안내용)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        try:
            return s.connect_ex((host if host != "0.0.0.0" else "127.0.0.1", port)) == 0
        except OSError:
            return False


def _open_app_ui(url: str) -> None:
    """앱 UI를 연다 — **크롬/엣지를 먼저** 시도하고, 없으면 기본 브라우저로 폴백.

    자동발급 RPA와 달리 앱 UI는 어떤 최신 브라우저에서도 동작하지만, 3D 히어로·온디바이스
    AI(번역 API 등)는 크롬/엣지에서 가장 잘 보인다. 그래서 사용자의 '기본 브라우저'가 크롬이
    아니어도(엣지·파폭·웨일 등) 우선 크롬→엣지로 열어 최상의 데모 경험을 보장하고, 둘 다 없거나
    실행 실패면 반드시 기본 브라우저로 폴백한다(어떤 경우든 창은 열린다).
    """
    if sys.platform == "win32":
        import subprocess
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pfx86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        local = os.environ.get("LocalAppData", "")
        candidates = [
            os.path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(pfx86, "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(local, "Google", "Chrome", "Application", "chrome.exe") if local else "",
            os.path.join(pfx86, "Microsoft", "Edge", "Application", "msedge.exe"),
            os.path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
        ]
        for exe in candidates:
            if exe and os.path.exists(exe):
                try:
                    subprocess.Popen([exe, url])
                    return
                except Exception:
                    pass  # 실행 실패 → 다음 후보/기본 브라우저
    # 폴백: OS 기본 브라우저(맥·리눅스 포함) — 무슨 일이 있어도 앱은 열린다.
    try:
        webbrowser.open(url)
    except Exception:
        pass


def _health_probe_url(url: str) -> str:
    """health 폴링 주소 — 바인드 주소(127.0.0.1)로 맞춘다. 윈도우에서 'localhost'가 IPv6(::1)로
    먼저 풀려 서버(127.0.0.1 바인드) 확인이 느려지거나 빗나가는 것 방지(브라우저 자동오픈 실패 원인)."""
    return url.replace("//localhost", "//127.0.0.1") + "api/health"


def _open_browser_when_ready(url: str):
    """서버 health가 뜨면 크롬/엣지 우선으로 앱을 연다.
    ⚠️ 실사용 제보: run-local-app 에서 브라우저가 안 열림 → 원인은 (1) 첫 기동(콜드 임포트)이 15초를
       넘겨 폴링이 조용히 포기, (2) localhost→::1 로 풀려 확인 실패. 대응:
       - 폴링 상한을 ~60초로 넉넉히(첫 실행은 느릴 수 있음), 주소는 127.0.0.1 로.
       - 60초 안에 확인 못 해도 '마지막엔 그냥 연다' — 서버가 느리게라도 떴으면 창은 열려야 한다
         (사용자가 새로고침 가능). '조용히 안 열림'이 최악이라 이 폴백을 둔다."""
    import threading
    import time
    import urllib.request

    probe = _health_probe_url(url)

    def _worker():
        for _ in range(120):  # 최대 ~60초 — 첫 실행(콜드 임포트·시딩)은 느릴 수 있어 넉넉히
            try:
                urllib.request.urlopen(probe, timeout=1)
                _open_app_ui(url)
                return
            except Exception:
                time.sleep(0.5)
        _open_app_ui(url)  # 확인 못 해도 마지막엔 연다 — '조용히 안 열림' 방지(서버는 대개 떠 있음)
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
        _open_app_ui(url)  # 크롬/엣지 우선 오픈(기본 브라우저 폴백)
        return

    # 서버가 뜨면 브라우저 자동 오픈(중복 오픈 방지 위해 여기 한 곳에서만 — agent_entry/bat는 위임).
    if open_browser:
        _open_browser_when_ready(url)
    # 접속 소음 줄이고(warning) 배너는 lifespan에서 출력.
    uvicorn.run(app, host=host, port=port, log_level="warning", access_log=False)


if __name__ == "__main__":  # pragma: no cover
    main()
