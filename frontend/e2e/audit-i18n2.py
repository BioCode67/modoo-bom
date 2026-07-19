# -*- coding: utf-8 -*-
import os
import io as _io, socket, subprocess, sys, time
from pathlib import Path

from _procutil import SPAWN_KW, stop_tree
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
FRONTEND = Path(__file__).resolve().parents[1]; OUT = FRONTEND/"e2e"/"audit"; OUT.mkdir(exist_ok=True)
def fp():
    with socket.socket() as s: s.bind(("127.0.0.1",0)); return s.getsockname()[1]
PORT=fp(); BASE=f"http://localhost:{PORT}/"
def wait(p,t=60):
    e=time.time()+t
    while time.time()<e:
        try:
            with socket.create_connection(("localhost",p),timeout=1): return True
        except OSError: time.sleep(0.5)
    return False
log=open(FRONTEND/"e2e"/"audit.log","w",encoding="utf-8")
if not (FRONTEND/"e2e-dist"/"index.html").exists():
    subprocess.run("npm run build -- --outDir e2e-dist --emptyOutDir --base /",cwd=str(FRONTEND),shell=True,stdout=log,stderr=subprocess.STDOUT)
srv=subprocess.Popen(f"npm run preview -- --outDir e2e-dist --port {PORT} --strictPort",cwd=str(FRONTEND),shell=True,stdout=log,stderr=subprocess.STDOUT,**SPAWN_KW)
try:
    if not wait(PORT): print("preview fail"); sys.exit(1)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path=(__import__("glob").glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome") or [None])[0]); ctx=b.new_context(viewport={"width":1280,"height":950})
        ctx.add_init_script("try{localStorage.setItem('modoobom-store', JSON.stringify({state:{uiLang:'en',onboarded:true},version:0}))}catch(e){}")
        pg=ctx.new_page()
        pg.goto(BASE,wait_until="networkidle"); pg.wait_for_timeout(1500)
        try: pg.click('[aria-label="닫기"]',timeout=2000)
        except Exception: pass
        pg.click("text=정책 탐색"); pg.wait_for_timeout(2500)
        # 일반 검색으로 기초연금 찾아 열기(AI 불필요)
        # 검색하지 않고(한국어 검색이 uiLang을 ko로 되돌리므로) 기본 목록의 첫 카드를 연다
        pg.locator('button:has-text("자세히")').first.click(timeout=8000)
        pg.wait_for_timeout(1500)
        pg.screenshot(path=str(OUT/"42-i18n-en-drawer.png")); print("✅ en drawer captured")
        b.close()
finally:
    stop_tree(srv); log.close()  # 셸+node 트리째 종료(_procutil) — 전 OS 고아 프리뷰 방지
