# -*- coding: utf-8 -*-
"""서민금융(FIN) 노출 확인 — 탐색에서 '햇살론'/'서민금융' 검색 시 결과가 뜨는지 + 캡처.
실행: backend\\venv\\Scripts\\python.exe frontend\\e2e\\audit-fin.py
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
    fails = []
    try:
        if not wait_port(PORT): print("preview 실패"); return 1
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=(__import__("glob").glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome") or [None])[0])
            pg = b.new_page(viewport={"width":1280,"height":900})
            pg.goto(BASE, wait_until="networkidle"); pg.wait_for_timeout(1200)
            try: pg.click('[aria-label="닫기"]', timeout=3000)
            except Exception: pass
            pg.click("text=정책 탐색")
            pg.wait_for_timeout(1500)
            # 검색창에 '햇살론' 입력
            box = pg.locator('input[type="search"], input[placeholder*="검색"], input[aria-label*="검색"]').first
            box.fill("햇살론")
            pg.wait_for_timeout(1500)
            try:
                pg.wait_for_selector("text=햇살론유스", timeout=6000)
                print("✅ '햇살론' 검색 → 햇살론유스 노출")
            except Exception:
                fails.append("'햇살론' 검색에 FIN 미노출")
                print("❌ '햇살론' 검색 실패")
            pg.screenshot(path=str(OUT/"20-fin-search.png"))
            # '대출' 검색도
            box.fill("대출")
            pg.wait_for_timeout(1500)
            try:
                pg.wait_for_selector("text=소액생계비대출", timeout=6000)
                print("✅ '대출' 검색 → 소액생계비대출 노출")
            except Exception:
                fails.append("'대출' 검색에 FIN 미노출")
                print("❌ '대출' 검색 실패")
            b.close()
    finally:
        stop_tree(server)  # 셸+node 트리째 종료(_procutil) — 전 OS 고아 프리뷰 방지
        log.close()
    if fails:
        print("\n❌ 서민금융 노출 회귀:", *fails, sep="\n  - "); return 1
    print("\n✅ 서민금융(FIN) 검색 노출 통과. 캡처 →", OUT)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
