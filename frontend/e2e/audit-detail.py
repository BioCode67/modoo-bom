# -*- coding: utf-8 -*-
"""정책 상세 드로어·신청 키트 시각 감사 — 신청 여정 핵심 화면 검수.
실행: backend\\venv\\Scripts\\python.exe frontend\\e2e\\audit-detail.py
"""
import os
import io as _io, socket, subprocess, sys, time
from pathlib import Path

from _procutil import SPAWN_KW, stop_tree
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
        cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT, **SPAWN_KW)
    try:
        if not wait_port(PORT): print("preview 실패"); return 1
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=(__import__("glob").glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome") or [None])[0])
            pg = b.new_page(viewport={"width":1280,"height":900})
            pg.goto(BASE, wait_until="networkidle"); pg.wait_for_timeout(1200)
            try: pg.click('[aria-label="닫기"]', timeout=3000)
            except Exception: pass
            # 탐색 → 기초연금 상세
            pg.click("text=정책 탐색"); pg.wait_for_timeout(1500)
            pg.click("text=기초연금", timeout=8000)
            pg.wait_for_timeout(1200)
            pg.screenshot(path=str(OUT/"d1-detail-top.png")); print("✅ d1-detail-top")
            # 드로어 내부 스크롤 아래(신청 키트·서류)
            try:
                drawer = pg.locator('[role="dialog"]').last
                drawer.evaluate("el => el.scrollTo(0, el.scrollHeight/2)")
                pg.wait_for_timeout(600)
                pg.screenshot(path=str(OUT/"d2-detail-mid.png")); print("✅ d2-detail-mid")
                drawer.evaluate("el => el.scrollTo(0, el.scrollHeight)")
                pg.wait_for_timeout(600)
                pg.screenshot(path=str(OUT/"d3-detail-bottom.png")); print("✅ d3-detail-bottom")
            except Exception as e:
                print("⚠️ 드로어 스크롤:", str(e)[:70])
                pg.mouse.wheel(0, 800); pg.wait_for_timeout(500)
                pg.screenshot(path=str(OUT/"d2-detail-mid.png")); print("✅ d2-detail-mid(휠)")
            b.close()
    finally:
        stop_tree(server)  # 셸+node 트리째 종료(_procutil) — 전 OS 고아 프리뷰 방지
        log.close()
    print("done →", OUT); return 0

if __name__ == "__main__":
    raise SystemExit(main())
