# -*- coding: utf-8 -*-
import os
import io as _io, socket, subprocess, sys, time
from pathlib import Path
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
FRONTEND = Path(__file__).resolve().parents[1]; OUT = FRONTEND/"e2e"/"audit"; OUT.mkdir(exist_ok=True)
def free_port():
    with socket.socket() as s: s.bind(("127.0.0.1",0)); return s.getsockname()[1]
PORT=free_port(); BASE=f"http://localhost:{PORT}/"
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
        b=p.chromium.launch(executable_path=(__import__("glob").glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome") or [None])[0]); pg=b.new_page(viewport={"width":1280,"height":1000})
        pg.goto(BASE,wait_until="networkidle"); pg.wait_for_timeout(1200)
        try: pg.click('[aria-label="닫기"]',timeout=3000)
        except Exception: pass
        pg.click("text=복지 찾기"); pg.click("text=직접 입력")
        # 복합: 66세 + 중증장애 + 저소득 → 기초연금·장애인연금 동시 → exclusive combo
        pg.fill('[aria-label="나이 직접 입력"]', "66"); pg.wait_for_timeout(200)
        # 위저드 3단계 개편: 소득 선택은 2단계(가구·소득)에 있다 — 1단계에서 바로 클릭하던 옛 흐름 수정
        pg.click("text=다음"); pg.wait_for_timeout(300)
        pg.click("text=가운데보다 낮아요"); pg.wait_for_timeout(200)
        pg.click("text=다음"); pg.wait_for_timeout(300)
        # step3 장애 토글
        try: pg.click("text=♿ 등록 장애인"); pg.wait_for_timeout(300)
        except Exception: pass
        pg.click("text=내 복지 분석하기"); pg.wait_for_timeout(400)
        pg.wait_for_selector("text=맞춤 추천 복지", timeout=30000)
        try:
            pg.get_by_text("수급 조합 도우미").scroll_into_view_if_needed(timeout=6000)
            pg.wait_for_timeout(500)
            pg.screenshot(path=str(OUT/"40-combo.png")); print("✅ combo card 노출")
        except Exception as e:
            print("⚠️ combo 미노출:", str(e)[:60]); pg.screenshot(path=str(OUT/"40-combo.png"))
        b.close()
finally:
    (subprocess.run(f"taskkill /F /T /PID {srv.pid}",shell=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL) if os.name=="nt" else srv.terminate()); log.close()  # 비윈도우 고아 프리뷰 방지
