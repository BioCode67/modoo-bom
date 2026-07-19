# -*- coding: utf-8 -*-
"""시연영상 초안 녹화 — 30초 투표용 핵심 여정을 실브라우저로 녹화(.webm).
여정: 홈 → 한 문장 입력(타이핑) → 분석 결과(64만원) → 챗 '다 담아줘' →
      📞 통화 상담(질문→답변, 🇻🇳 다국어 전환) → 서류 준비 도우미.
실행: backend\\venv\\Scripts\\python.exe frontend\\e2e\\record-demo.py
출력: frontend/e2e/demo-video/*.webm (유튜브 업로드 가능)
"""
import os
import io as _io, socket, subprocess, sys, time
from pathlib import Path

from _procutil import SPAWN_KW, stop_tree
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
FRONTEND = Path(__file__).resolve().parents[1]
OUT = FRONTEND / "e2e" / "demo-video"; OUT.mkdir(exist_ok=True)

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
    log = open(FRONTEND/"e2e"/"record.log","w",encoding="utf-8")
    if not (FRONTEND/"e2e-dist"/"index.html").exists():
        print("[rec] e2e-dist 빌드 …")
        subprocess.run("npm run build -- --outDir e2e-dist --emptyOutDir --base /",
            cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT)
    server = subprocess.Popen(f"npm run preview -- --outDir e2e-dist --port {PORT} --strictPort",
        cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT, **SPAWN_KW)
    try:
        if not wait_port(PORT): print("preview 실패"); return 1
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=(__import__("glob").glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome") or [None])[0])
            ctx = b.new_context(
                viewport={"width":1280,"height":720},
                record_video_dir=str(OUT),
                record_video_size={"width":1280,"height":720},
            )
            pg = ctx.new_page()
            pg.goto(BASE, wait_until="networkidle"); pg.wait_for_timeout(1500)
            try: pg.click('[aria-label="닫기"]', timeout=3000)
            except Exception: pass
            pg.wait_for_timeout(1200)  # 홈 히어로 감상

            # 한 문장 입력(사람처럼 타이핑)
            box = pg.locator('input[placeholder*="72세"], input[aria-label*="한 문장"], textarea').first
            try:
                box.click(timeout=4000)
                box.press_sequentially("72세 혼자 사는데 소득이 적어요", delay=70)
                pg.wait_for_timeout(700)
                pg.keyboard.press("Enter")
            except Exception:
                # 히어로 예시 칩 폴백
                pg.click("text=72세 혼자 사는데 소득이 적어요")
                pg.wait_for_timeout(400)
                pg.click("text=내 복지 찾기")

            # 분석 연출 + 결과
            pg.wait_for_selector("text=맞춤 추천 복지", timeout=40000)
            pg.wait_for_timeout(2200)  # 헤더(37개·64만원) 감상
            pg.mouse.wheel(0, 500); pg.wait_for_timeout(1500)   # 에이전트 요약
            pg.mouse.wheel(0, 900); pg.wait_for_timeout(1800)   # 카드들
            pg.evaluate("window.scrollTo({top:0,behavior:'smooth'})"); pg.wait_for_timeout(1000)

            # 챗 에이전트: 다 담아줘
            pg.click('[aria-label="복지 도우미 챗봇 열기"]'); pg.wait_for_timeout(1400)
            chat = pg.locator('[aria-label="질문 입력"]')
            chat.press_sequentially("다 담아줘", delay=90)
            pg.wait_for_timeout(400)
            pg.keyboard.press("Enter")
            pg.wait_for_selector("text=담았어요", timeout=10000)
            pg.wait_for_timeout(1800)

            # 📞 통화형 상담 — 말로 묻고 소리로 듣는 상담(+다국어) 하이라이트
            pg.click('[aria-label="음성 통화 상담으로 전환"]')
            pg.wait_for_selector('[role="dialog"][aria-label="새싹이와 통화 상담"]', timeout=8000)
            pg.wait_for_timeout(1600)  # 인사 브리핑 감상
            call_in = pg.locator('[aria-label="말 대신 입력하기"]')
            call_in.press_sequentially("기초연금 알려줘", delay=80)
            pg.wait_for_timeout(400)
            pg.click('[aria-label="입력 보내기"]')
            pg.wait_for_selector("text=기초연금", timeout=8000)
            pg.wait_for_timeout(2000)  # 큰 글씨 답변 감상
            # 🌍 다국어: 베트남어 전환 → 자국어 인사(외국인 무장벽 한 컷)
            pg.select_option('select[aria-label="상담 언어 선택 (Language)"]', "vi")
            pg.wait_for_selector("text=Xin chào", timeout=6000)
            pg.wait_for_timeout(2000)
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(400)

            # 나의 복지 → 서류 준비 도우미
            pg.click("text=나의 복지"); pg.wait_for_timeout(1800)
            try:
                pg.get_by_text("서류 준비 도우미").scroll_into_view_if_needed(timeout=6000)
                pg.wait_for_timeout(2200)
                pg.mouse.wheel(0, 400); pg.wait_for_timeout(1500)
            except Exception:
                pass
            pg.wait_for_timeout(800)

            ctx.close()  # 비디오 저장
            b.close()
        vids = sorted(OUT.glob("*.webm"), key=lambda f: f.stat().st_mtime)
        if vids:
            final = OUT / "modoobom-demo.webm"
            vids[-1].replace(final)
            print(f"[rec] ✅ 저장: {final} ({final.stat().st_size//1024}KB)")
        else:
            print("[rec] ❌ 비디오 파일 없음"); return 1
    finally:
        stop_tree(server)  # 셸+node 트리째 종료(_procutil) — 전 OS 고아 프리뷰 방지
        log.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
