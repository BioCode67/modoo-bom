# -*- coding: utf-8 -*-
"""대화형 온보딩(MascotChat) 시각+동작 확인 — 새싹이와 대화하며 프로필 완성→분석 도달.
실행: backend\\venv\\Scripts\\python.exe frontend\\e2e\\audit-chat.py
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
    fails = []
    try:
        if not wait_port(PORT): print("preview 실패"); return 1
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width":1280,"height":900})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(BASE, wait_until="networkidle"); pg.wait_for_timeout(1200)
            try: pg.click('[aria-label="닫기"]', timeout=3000)
            except Exception: pass
            pg.click("text=복지 찾기")
            pg.wait_for_timeout(800)
            # 대화형 기본 노출 확인
            pg.wait_for_selector("text=모두봄 에이전트", timeout=8000)
            pg.wait_for_selector("text=어떻게 불러드릴까요", timeout=5000)
            pg.screenshot(path=str(OUT/"30-chat-start.png"))
            print("✅ 대화형 온보딩 기본 노출")
            # name: 건너뛰기
            pg.click("text=건너뛰기")
            pg.wait_for_timeout(500)
            # age: 65세 이상 어르신
            pg.click("text=65세 이상 어르신")
            pg.wait_for_timeout(600)
            # income: 소득이 적은 편이에요
            pg.click("text=소득이 적은 편이에요")
            pg.wait_for_timeout(600)
            # household: 1인가구
            pg.click("text=1인가구")
            pg.wait_for_timeout(600)
            pg.screenshot(path=str(OUT/"31-chat-mid.png"))
            # situations: 해당 없어요, 다음
            pg.click("text=해당 없어요")
            pg.wait_for_timeout(300)
            pg.click("text=해당 없어요, 다음 →")
            pg.wait_for_timeout(600)
            # region: 넘어가기
            try:
                pg.click("text=괜찮아요, 넘어갈게요 →", timeout=5000)
            except Exception:
                fails.append("region 단계 미도달")
            # 분석 결과 도달
            try:
                pg.wait_for_selector("text=맞춤 추천 복지", timeout=30000)
                print("✅ 대화 완료 → 분석 결과 도달")
            except Exception:
                fails.append("분석 결과 미도달")
            pg.screenshot(path=str(OUT/"32-chat-result.png"))
            if errs:
                fails.append(f"pageerror {len(errs)}건: {errs[0][:80]}")
            b.close()
    finally:
        subprocess.run(f"taskkill /F /T /PID {server.pid}", shell=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log.close()
    if fails:
        print("\n❌ 대화형 온보딩 회귀:", *fails, sep="\n  - "); return 1
    print("\n✅ 대화형 온보딩 통과 (대화→프로필→분석). 캡처 →", OUT)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
