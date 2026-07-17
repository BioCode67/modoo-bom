# -*- coding: utf-8 -*-
"""자동화 UX 회귀 게이트 — 분석 → (챗 열자마자)"다 담아줘" 저장 → 서류센터 노출을 검증.
'분석 직후 다 담아줘'가 저장으로 이어지지 않던 회귀(챗 맥락 없으면 검색으로 샘)를 막는다.
실패 시 non-zero 반환. 실행: backend\\venv\\Scripts\\python.exe frontend\\e2e\\audit-flow.py
"""
import io as _io, socket, subprocess, sys, time
from pathlib import Path
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
FRONTEND = Path(__file__).resolve().parents[1]
OUT = FRONTEND / "e2e" / "audit"; OUT.mkdir(exist_ok=True)

def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); return s.getsockname()[1]
PORT = free_port(); BASE = f"http://localhost:{PORT}/"

def wait_port(p, t=60):
    end = time.time()+t
    while time.time()<end:
        try:
            with socket.create_connection(("localhost", p), timeout=1): return True
        except OSError: time.sleep(0.5)
    return False

def main():
    log = open(FRONTEND/"e2e"/"audit.log","w",encoding="utf-8")
    if not (FRONTEND/"e2e-dist"/"index.html").exists():
        subprocess.run("npm run build -- --outDir e2e-dist --emptyOutDir --base /",
            cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT)
    server = subprocess.Popen(f"npm run preview -- --outDir e2e-dist --port {PORT} --strictPort",
        cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT)
    try:
        if not wait_port(PORT): print("preview 실패"); return 1
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            import glob as _glob
            _exe = _glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")  # 컨테이너/CI 폴백(로컬 PC는 빈 리스트=기본)
            b = p.chromium.launch(executable_path=(_exe[0] if _exe else None))
            pg = b.new_page(viewport={"width":1280,"height":900})
            pg.goto(BASE, wait_until="networkidle"); pg.wait_for_timeout(1200)
            try: pg.click('[aria-label="닫기"]', timeout=3000)
            except Exception: pass
            # 분석: 복지 찾기 → (기본이 '새싹이와 대화'라) 직접 입력 탭 → 데모 페르소나 → 결과
            pg.click("text=복지 찾기")
            pg.click("text=직접 입력")
            pg.click("text=독거 어르신")
            pg.wait_for_selector("text=맞춤 추천 복지", timeout=30000)
            pg.wait_for_timeout(800)
            pg.screenshot(path=str(OUT/"10-result-top.png"))
            print("✅ 10-result-top")
            pg.screenshot(path=str(OUT/"11-result-full.png"), full_page=True)
            print("✅ 11-result-full")
            fails = []
            # 챗 열자마자(사전 검색 없이) "다 담아줘" → 분석결과(POL-) 폴백 저장이 동작해야 함
            pg.click('[aria-label="복지 도우미 챗봇 열기"]')
            pg.wait_for_timeout(700)
            pg.fill('[aria-label="질문 입력"]', "다 담아줘")
            pg.keyboard.press("Enter")
            try:
                pg.wait_for_selector("text=담았어요", timeout=8000)
                print("✅ '다 담아줘' → 분석결과 저장(폴백) 동작")
            except Exception:
                fails.append("'다 담아줘'가 저장으로 이어지지 않음(챗 맥락 없을 때 폴백 실패)")
                print("❌ '다 담아줘' 저장 실패")
            pg.keyboard.press("Escape")
            # 나의 복지로 이동
            try: pg.click("text=나의 복지", timeout=5000)
            except Exception:
                try: pg.click('[aria-label="하단 메뉴"] >> text=나의 복지', timeout=5000)
                except Exception: fails.append("나의 복지 이동 실패")
            pg.wait_for_timeout(1500)
            pg.screenshot(path=str(OUT/"12-my-full.png"), full_page=True)
            print("✅ 12-my-full")
            # 서류 준비 도우미(서류 자동발급/링크 UI)가 실제로 떠야 함 — 저장이 됐다는 증거
            try:
                pg.get_by_text("서류 준비 도우미").scroll_into_view_if_needed(timeout=6000)
                pg.wait_for_timeout(600)
                pg.screenshot(path=str(OUT/"13-doc-center.png"))
                print("✅ 13-doc-center(서류 준비 도우미 노출)")
            except Exception as e:
                fails.append(f"서류 준비 도우미 미노출({str(e)[:40]})")
                print("❌ 서류 준비 도우미 미노출")
            b.close()
    finally:
        subprocess.run(f"taskkill /F /T /PID {server.pid}", shell=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log.close()
    if fails:
        print("\n❌ 자동화 저장 흐름 회귀:")
        for f in fails: print("  -", f)
        return 1
    print("\n✅ 자동화 저장 흐름 통과 (분석 → 다 담아줘 → 서류센터). 캡처 →", OUT)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
