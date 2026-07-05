# -*- coding: utf-8 -*-
import io as _io, socket, subprocess, sys, time
from pathlib import Path
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
srv=subprocess.Popen(f"npm run preview -- --outDir e2e-dist --port {PORT} --strictPort",cwd=str(FRONTEND),shell=True,stdout=log,stderr=subprocess.STDOUT)
try:
    if not wait(PORT): print("preview fail"); sys.exit(1)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":950})
        pg.goto(BASE,wait_until="networkidle"); pg.wait_for_timeout(1200)
        try: pg.click('[aria-label="닫기"]',timeout=3000)
        except Exception: pass
        pg.click("text=정책 탐색"); pg.wait_for_timeout(1500)
        # AI 의미검색 켜고 영어로 질의 → uiLang=en
        try: pg.click("text=AI 의미 검색"); pg.wait_for_timeout(800)
        except Exception: pass
        box=pg.locator('input[type="search"], input[placeholder*="검색"], input[placeholder*="English"]').first
        box.fill("I have a low income and need help"); pg.wait_for_timeout(3500)
        # 첫 카드 열기
        try:
            pg.locator('.card-cute, [class*="card"]').filter(has_text="").first
        except Exception: pass
        pg.wait_for_timeout(500)
        # 아무 정책 카드 클릭
        cards = pg.locator("text=자세히")
        if cards.count()==0:
            cards = pg.locator('h3, .font-bold')
        try:
            pg.get_by_text("기초연금").first.click(timeout=5000)
        except Exception:
            try: pg.locator('button:has-text("자세히")').first.click(timeout=5000)
            except Exception: pass
        pg.wait_for_timeout(1500)
        pg.screenshot(path=str(OUT/"41-i18n-en.png")); print("✅ i18n en drawer captured")
        b.close()
finally:
    subprocess.run(f"taskkill /F /T /PID {srv.pid}",shell=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); log.close()
