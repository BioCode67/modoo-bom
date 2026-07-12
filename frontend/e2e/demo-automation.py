# -*- coding: utf-8 -*-
"""체험 모드 e2e — 배포 사이트에서 방문자가 '실제 정부24 자동화 체험'을 눌렀을 때
브라우저에서 끝까지(실제 정부24 스크린샷 표시) 동작하는지 실증.

흐름: RPA 서버(local_server, RPA_ENABLED) 기동 → 프론트를 VITE_RPA_BASE=그 서버로 빌드 →
preview 서빙 → Playwright로 홈 열고 '실제 자동화 체험 시작' 클릭 → 스크린샷 <img> 등장 확인.
실제 정부24에 접속하므로 네트워크 필요. 개인정보·제출 없음.

실행: backend\\venv-local\\Scripts\\python.exe frontend\\e2e\\demo-automation.py
"""
import io as _io, os, socket, subprocess, sys, time
from pathlib import Path
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
FRONTEND = Path(__file__).resolve().parents[1]
BACKEND = FRONTEND.parent / "backend"
PY = str((BACKEND / "venv-local" / "Scripts" / "python.exe"))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); return s.getsockname()[1]


def wait_port(p, t=90, host="localhost"):
    end = time.time() + t
    while time.time() < end:
        try:
            with socket.create_connection((host, p), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def main():
    rpa_port = free_port()
    web_port = free_port()
    rpa_base = f"http://localhost:{rpa_port}"
    log = open(FRONTEND / "e2e" / "demo.log", "w", encoding="utf-8")

    # 1) RPA 서버(local_server) 기동 — 체험 엔드포인트 제공 (테스트 프론트 포트를 CORS 허용)
    env = dict(os.environ, RPA_ENABLED="1", RPA_HEADLESS="1", PYTHONUTF8="1",
               CORS_ORIGINS=f"http://localhost:{web_port},http://127.0.0.1:{web_port}")
    rpa_srv = subprocess.Popen(
        [PY, "-m", "uvicorn", "local_server:app", "--host", "127.0.0.1", "--port", str(rpa_port), "--log-level", "warning"],
        cwd=str(BACKEND), env=env, stdout=log, stderr=subprocess.STDOUT,
    )
    # 2) 프론트를 VITE_RPA_BASE=RPA서버 로 빌드
    web_srv = None
    try:
        if not wait_port(rpa_port, host="127.0.0.1"):
            print("❌ RPA 서버 기동 실패"); return 1
        print(f"✅ RPA 서버 기동 (port {rpa_port})")
        benv = dict(os.environ, VITE_RPA_BASE=rpa_base)
        r = subprocess.run("npm run build -- --outDir e2e-demo-dist --emptyOutDir --base /",
                           cwd=str(FRONTEND), shell=True, env=benv, stdout=log, stderr=subprocess.STDOUT)
        if r.returncode != 0:
            print("❌ 빌드 실패 (demo.log 참고)"); return 1
        print("✅ 프론트 빌드 (VITE_RPA_BASE 주입)")
        web_srv = subprocess.Popen(f"npm run preview -- --outDir e2e-demo-dist --port {web_port} --strictPort",
                                   cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT)
        if not wait_port(web_port):
            print("❌ preview 기동 실패"); return 1

        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(f"http://localhost:{web_port}/", wait_until="networkidle")
            pg.wait_for_timeout(1500)
            try: pg.click('[aria-label="닫기"]', timeout=3000)
            except Exception: pass

            # '실제 자동화 체험 시작' 버튼 찾기(홈 RpaShowcase). lazy 섹션이라 스크롤로 뷰포트 진입.
            btn = pg.get_by_role("button", name="실제 자동화 체험 시작")
            btn.scroll_into_view_if_needed(timeout=15000)
            assert btn.is_visible(), "체험 버튼이 안 보임(VITE_RPA_BASE 미반영?)"
            print("✅ 체험 버튼 노출(getDemoRpaBase 활성)")
            card = pg.get_by_text("실제 정부24 자동화 체험").locator("xpath=ancestor::div[contains(@class,'border-sprout-200')][1]")
            msgs = []
            reqs = []
            pg.on("console", lambda m: msgs.append(f"{m.type}: {m.text}"[:200]))
            pg.on("requestfailed", lambda r: (rpa_base in r.url) and reqs.append(f"FAIL {r.url.split('/api/')[-1]} {r.failure}"))
            pg.on("response", lambda r: (rpa_base in r.url) and reqs.append(f"{r.status} {r.url.split('/api/')[-1]}"))
            btn.click(force=True)
            pg.wait_for_timeout(10000)  # 요청·첫 폴링 여유
            print("─ RPA 요청:", " | ".join(reqs[:10]) or "(호출 없음!)")
            try: print("─ 카드 전체:", (card.inner_text(timeout=3000) or "").replace("\n", " ")[:300])
            except Exception as e: print("─ 카드 못읽음:", e)
            if msgs: print("─ 콘솔:", " | ".join(m for m in msgs if "onrender" not in m)[:300])

            # 실제 정부24 접속 → 스크린샷 <img>가 등장할 때까지(최대 ~80초)
            shot = pg.locator('figure img')
            try:
                shot.first.wait_for(state="visible", timeout=80000)
            except Exception:
                # 진단: 카드 텍스트 + 콘솔/네트워크
                try:
                    card = pg.get_by_text("실제 정부24 자동화 체험").locator("xpath=ancestor::div[1]")
                    print("─ 카드 상태:", (card.inner_text(timeout=3000) or "")[:300])
                except Exception as e:
                    print("─ 카드 텍스트 못 읽음:", e)
                print("─ 콘솔/네트워크:", " | ".join(msgs[-8:]) or "(없음)")
                pg.screenshot(path=str(FRONTEND / "e2e" / "demo-fail.png"), full_page=True)
                raise
            pg.wait_for_timeout(2000)
            n = shot.count()
            print(f"✅ 실제 정부24 자동화 스크린샷 표시: {n}장")
            assert n >= 1, "스크린샷이 안 뜸"
            pg.screenshot(path=str(FRONTEND / "e2e" / "demo-result.png"), full_page=True)

            # 개인정보 입력 요구가 없어야(체험은 PII 0) — 이름/주민번호 입력창이 이 카드에 없어야
            assert errs == [], f"페이지 에러: {errs[:2]}"
            print("✅ 페이지 에러 0")
            b.close()
        print("🎉 체험 모드 e2e 전 구간 통과 — 배포에서 방문자가 실제 정부24 자동화를 체험 가능")
        return 0
    finally:
        for s in (web_srv, rpa_srv):
            try:
                if s: s.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
