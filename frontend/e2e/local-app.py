# -*- coding: utf-8 -*-
"""모두봄 로컬 앱 E2E — 동일출처 자동발급 체인 회귀 가드.

로컬 데스크탑 앱(backend가 프론트를 localhost에서 직접 서빙)의 핵심 계약을 실브라우저로 검증:
  1) build:app 산출물(dist-app)을 local_server 가 동일 출처로 서빙
  2) 프론트가 로컬 에이전트를 감지 → capabilities.rpa=true
  3) '자동발급 가능' UI(주민등록등본 '자동' 버튼)가 노출
  4) 동일 출처라 CORS/권한(LNA) 에러가 0, pageerror 0

이 가드가 깨지면 배포는 되지만 자동발급이 침묵으로 죽는 회귀를 데모 전에 잡는다.

실행(레포 루트에서, deps 있는 파이썬으로):
    frontend> ../backend/venv-local/Scripts/python.exe e2e/local-app.py
    (또는 npm run e2e:app)
"""
import io as _io
import json
import os
import socket
import subprocess

from _procutil import SPAWN_KW, stop_tree
import sys
import time
from pathlib import Path

sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

FRONTEND = Path(__file__).resolve().parents[1]
BACKEND = FRONTEND.parent / "backend"
DIST_APP = FRONTEND / "dist-app"

SEED = {"state": {"tracked": [{"policyId": "POL-001", "name": "기초연금", "category": "노인",
        "status": "tracking", "savedAt": 1, "checkedDocs": []}], "docDone": {},
        "onboarded": True, "uiLang": "ko"}, "version": 0}


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_health(port: int, timeout: float = 40) -> bool:
    import urllib.request
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1):
                return True
        except Exception:
            time.sleep(0.5)
    return False


def main() -> int:
    # 1) 로컬 앱 번들 빌드(dist-app)
    print("[e2e:app] dist-app 빌드 중 …")
    log = open(FRONTEND / "e2e" / "local-app.log", "w", encoding="utf-8")
    r = subprocess.run("npm run build:app", cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT)
    if r.returncode != 0 or not (DIST_APP / "index.html").is_file():
        print("[e2e:app] ❌ build:app 실패 — e2e/local-app.log 확인")
        return 2

    # 2) 경량 로컬 에이전트 기동(RPA 활성, 동일 출처 서빙)
    port = free_port()
    env = dict(os.environ, RPA_ENABLED="1", PYTHONUTF8="1", HOST="127.0.0.1", PORT=str(port))
    print(f"[e2e:app] local_server 기동(:{port}) …")
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "local_server:app", "--host", "127.0.0.1",
         "--port", str(port), "--log-level", "warning"],
        cwd=str(BACKEND), env=env, stdout=log, stderr=subprocess.STDOUT,
        **SPAWN_KW,
    )
    try:
        if not wait_health(port):
            print("[e2e:app] ❌ local_server 가 뜨지 않음 — e2e/local-app.log 확인")
            return 1

        from playwright.sync_api import sync_playwright
        url = f"http://localhost:{port}/"
        errors, cors_errors, health_hits = [], [], []
        # 레지스트리에 chromium이 없는 환경(컨테이너)용 폴백 — desktop-smoke와 동일 방식
        import glob as _glob
        _exe = _glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, executable_path=(_exe[0] if _exe else None))
            ctx = b.new_context()
            ctx.add_init_script(f"try{{localStorage.setItem('modoobom-store', {json.dumps(json.dumps(SEED))})}}catch(e){{}}")
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
            pg.on("console", lambda m: cors_errors.append(m.text[:160]) if ("CORS" in m.text or "Permission" in m.text) else None)
            pg.on("request", lambda rq: health_hits.append(rq.url) if "/api/health" in rq.url else None)
            pg.goto(url, wait_until="load")
            pg.wait_for_timeout(1500)
            # 나의 복지로 이동 → '서류 발급' 탭(탭 레이아웃 — 자동발급 UI·인증 폼은 이 탭에 렌더,
            # 기본 탭(담은 복지)에선 display:none이라 innerText 검사에 안 잡힌다)
            pg.evaluate("(kw)=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent&&x.textContent.includes(kw));if(b)b.click();}", "나의")
            pg.wait_for_timeout(1500)
            pg.evaluate("(kw)=>{const b=[...document.querySelectorAll(\"[role='tab']\")].find(x=>x.textContent&&x.textContent.includes(kw));if(b)b.click();}", "서류 발급")
            pg.wait_for_timeout(4500)
            body = pg.inner_text("body")
            health = pg.evaluate("async()=>{try{const r=await fetch('/api/health');const j=await r.json();return j.capabilities.rpa;}catch(e){return 'ERR '+e.message;}}")
            b.close()

        checks = [
            ("동일출처 health 요청", len(health_hits) >= 1),
            ("capabilities.rpa=true", health is True),
            ("'자동발급 가능' UI", ("자동 발급" in body or "자동발급" in body)),
            ("주민등록등본 서류 노출", "주민등록등본" in body),
            # 감사 수정 회귀: 인증수단 선택 UI + '다음 분 상담' 리셋 버튼(공용PC PII)
            ("본인인증 앱 선택 UI", "본인인증 앱" in body),
            ("인증수단 통신사 PASS 옵션", "통신사 PASS" in body),
            ("'다음 분 상담 시작' 리셋 버튼", "다음 분 상담 시작" in body),
            ("pageerror 0", len(errors) == 0),
            ("CORS/권한 에러 0", len(cors_errors) == 0),
        ]
        ok = all(v for _, v in checks)
        for name, v in checks:
            print(f"   {'✅' if v else '❌'} {name}")
        if not ok:
            if errors: print("   pageerror:", errors[:2])
            if cors_errors: print("   cors:", cors_errors[:2])
            print("[e2e:app] ❌ 로컬 앱 자동발급 체인 회귀 감지")
            return 1
        print("[e2e:app] ✅ 로컬 앱 동일출처 자동발급 체인 정상")
        return 0
    finally:
        stop_tree(server)  # 트리째 종료(_procutil) — uvicorn 고아 방지
        log.close()


if __name__ == "__main__":
    sys.exit(main())
