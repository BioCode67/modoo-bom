# -*- coding: utf-8 -*-
"""배포 화면 시각 감사 — 핵심 뷰를 스크린샷으로 캡처해 개선 지점을 눈으로 찾는다.
실행: backend\\venv\\Scripts\\python.exe frontend\\e2e\\visual-audit.py
"""
import os
import io as _io, os, socket, subprocess, sys, time
from pathlib import Path
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
FRONTEND = Path(__file__).resolve().parents[1]
OUT = FRONTEND / "e2e" / "audit"
OUT.mkdir(exist_ok=True)

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
            b = p.chromium.launch(executable_path=(__import__("glob").glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome") or [None])[0])
            pg = b.new_page(viewport={"width":1280,"height":900})
            pg.goto(BASE, wait_until="networkidle"); pg.wait_for_timeout(1500)
            # 온보딩 모달 닫기(있으면)
            for label in ("시작하기","둘러보기","닫기","확인"):
                try:
                    el = pg.get_by_role("button", name=label)
                    if el.count(): el.first.click(timeout=800); pg.wait_for_timeout(300); break
                except Exception: pass
            pg.screenshot(path=str(OUT/"01-home.png"))
            print("✅ 01-home")
            # 스크롤하며 각 뷰포트 캡처 → whileInView(스크롤 등장) 섹션이 실제로 뜨는지 확인
            total = pg.evaluate("document.body.scrollHeight")
            vh = 900
            i = 0
            y = 0
            while y < total:
                pg.evaluate(f"window.scrollTo(0,{y})")
                pg.wait_for_timeout(900)  # whileInView 애니메이션 여유
                pg.screenshot(path=str(OUT/f"scroll-{i:02d}.png"))
                print(f"✅ scroll-{i:02d} (y={y}/{total})")
                y += vh; i += 1
            # 스크롤 끝난 뒤 풀페이지(모든 섹션 등장 상태)
            pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(300)
            pg.screenshot(path=str(OUT/"02-home-full.png"), full_page=True)
            print("✅ 02-home-full")
            b.close()
    finally:
        if os.name == "nt":
            subprocess.run(f"taskkill /F /T /PID {server.pid}", shell=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:  # 리눅스/맥 — taskkill이 없어 프리뷰가 고아로 남던 문제(포트 점유 원인) 방지
            server.terminate()
            try:
                server.wait(timeout=5)
            except Exception:
                server.kill()
        log.close()
    print("done →", OUT)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
