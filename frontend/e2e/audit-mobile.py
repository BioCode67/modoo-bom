# -*- coding: utf-8 -*-
"""모바일(390px) 전 뷰 시각 감사 — 홈·대화형분석·결과·탐색·나의복지·챗을 캡처.
'결국 PC 켜야 한다'는 기존 복지앱 불만에 대응해 모바일 완성도를 눈으로 검수.
실행: backend\\venv\\Scripts\\python.exe frontend\\e2e\\audit-mobile.py
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
            pg = b.new_page(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(BASE, wait_until="networkidle"); pg.wait_for_timeout(1500)
            try: pg.click('[aria-label="닫기"]', timeout=3000)
            except Exception: pass
            pg.screenshot(path=str(OUT/"m1-home.png")); print("✅ m1-home")
            # 하단 탭바로 복지 찾기
            pg.click('[aria-label="하단 메뉴"] >> text=복지 찾기')
            pg.wait_for_timeout(1000)
            pg.screenshot(path=str(OUT/"m2-analyze-chat.png")); print("✅ m2-analyze-chat")
            # 대화 진행: 건너뛰기→어르신→(큰글씨 제안 확인)
            try:
                pg.click("text=건너뛰기", timeout=5000); pg.wait_for_timeout(400)
                pg.click("text=65세 이상 어르신"); pg.wait_for_timeout(700)
                pg.screenshot(path=str(OUT/"m3-elderly-offer.png")); print("✅ m3-elderly-offer(큰글씨 제안)")
                # 큰글씨 수락
                pg.click("text=네, 크게 볼래요"); pg.wait_for_timeout(500)
                pg.screenshot(path=str(OUT/"m4-elderly-on.png")); print("✅ m4-elderly-on(큰글씨 적용)")
                pg.click("text=소득이 적은 편이에요"); pg.wait_for_timeout(500)
                pg.click("text=1인가구"); pg.wait_for_timeout(500)
                pg.click("text=해당 없어요"); pg.wait_for_timeout(300)
                pg.click("text=해당 없어요, 다음 →"); pg.wait_for_timeout(500)
                pg.click("text=괜찮아요, 넘어갈게요 →"); pg.wait_for_timeout(300)
                pg.wait_for_selector("text=맞춤 추천 복지", timeout=30000)
                pg.screenshot(path=str(OUT/"m5-result.png")); print("✅ m5-result(모바일 결과)")
            except Exception as e:
                print("⚠️ 모바일 대화 흐름:", str(e)[:80])
            # 탐색
            pg.click('[aria-label="하단 메뉴"] >> text=정책 탐색'); pg.wait_for_timeout(1500)
            pg.screenshot(path=str(OUT/"m6-explore.png")); print("✅ m6-explore")
            # 나의 복지
            pg.click('[aria-label="하단 메뉴"] >> text=나의 복지'); pg.wait_for_timeout(1200)
            pg.screenshot(path=str(OUT/"m7-my.png")); print("✅ m7-my")
            if errs: print("❌ pageerror:", errs[:3])
            else: print("✅ 페이지 에러 0")
            b.close()
    finally:
        stop_tree(server)  # 셸+node 트리째 종료(_procutil) — 전 OS 고아 프리뷰 방지
        log.close()
    print("done →", OUT); return 0

if __name__ == "__main__":
    raise SystemExit(main())
