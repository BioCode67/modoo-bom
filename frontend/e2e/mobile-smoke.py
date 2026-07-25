# -*- coding: utf-8 -*-
"""모바일(390px) 스모크 — 폰 폼팩터에서 핵심 화면이 깨지지 않는지 고정.

카메라(서류 촬영)는 본래 폰 기능이라 모바일 검증이 중요. 검증:
  1) 홈 로드 + 가로 오버플로 0 (body.scrollWidth ≤ viewport)
  2) 하단 탭바로 '나의 복지' 이동(데스크탑 nav는 md:hidden) → 서류 도우미
  3) 서류 촬영 모달 열림 + 가짜 카메라로 1장 촬영(getUserMedia 폰 경로)
  4) 각 화면 가로 오버플로 0 · 전 구간 pageerror 0

실행:  cd frontend && python3 e2e/mobile-smoke.py
"""
import io as _io, os, socket, subprocess, sys, time, glob
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from pathlib import Path

from _procutil import SPAWN_KW, stop_tree
FRONTEND = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); return s.getsockname()[1]


def wait_port(port, t=60):
    e = time.time() + t
    while time.time() < e:
        try:
            with socket.create_connection(("localhost", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def main():
    PORT = free_port()
    log = open(FRONTEND / "e2e" / "preview.log", "w", encoding="utf-8")
    print("[mobile] e2e-dist-mobile 빌드 중 …")
    if subprocess.run("npm run build -- --outDir e2e-dist-mobile --emptyOutDir --base /",
                      cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT).returncode != 0:
        print("[mobile] ❌ 빌드 실패"); return 2
    server = subprocess.Popen(f"npm run preview -- --outDir e2e-dist-mobile --port {PORT} --strictPort",
                              cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT, **SPAWN_KW)
    issues = []
    try:
        if not wait_port(PORT):
            print("[mobile] ❌ preview 안 뜸"); return 1
        from playwright.sync_api import sync_playwright
        exe = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=(exe[0] if exe else None),
                                  args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
            ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            ctx.grant_permissions(["camera"])
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: issues.append("pageerror: " + str(e)[:90]))
            pg.add_init_script("localStorage.setItem('modoobom-store',JSON.stringify({state:{onboarded:true,tracked:[{policyId:'POL-009',name:'청년월세지원',category:'청년',status:'idle',savedAt:1,checkedDocs:[]}],docDone:{}},version:0}))")

            def mclick(text):
                loc = pg.get_by_text(text)
                for i in range(loc.count()):
                    if loc.nth(i).is_visible():
                        loc.nth(i).click(); return
                raise Exception(f"visible '{text}' 없음")

            def hof(tag):
                o = pg.evaluate("()=>({b:document.body.scrollWidth,w:window.innerWidth})")
                if o["b"] > o["w"] + 2:
                    issues.append(f"가로오버플로@{tag}: body {o['b']} > vw {o['w']}")

            pg.goto(f"http://localhost:{PORT}/", wait_until="domcontentloaded", timeout=30000)
            pg.wait_for_selector("text=정부·지자체·민간 복지", timeout=20000)
            pg.wait_for_timeout(600); hof("home")
            print("[mobile] ✅ 홈 로드(오버플로 0)")
            mclick("나의 복지")
            # 탭 레이아웃(기본: 담은 복지) — 서류 도우미는 '서류 발급' 탭에 있다(desktop-smoke goto_my_docs와 동일 패턴)
            pg.wait_for_selector("[role='tab']:has-text('서류 발급')", timeout=15000)
            pg.click("[role='tab']:has-text('서류 발급')")
            pg.wait_for_selector("text=서류 준비 도우미", timeout=15000)
            pg.wait_for_timeout(600); hof("나의복지")
            print("[mobile] ✅ 하단탭 → 나의 복지 · 서류 발급 탭 · 서류 도우미")
            btn = pg.locator("button:has-text('📷 촬영')").first
            btn.scroll_into_view_if_needed(); btn.click()
            pg.wait_for_selector("div[role='dialog'][aria-label*='촬영']", timeout=8000)
            pg.wait_for_timeout(800); hof("촬영모달")
            pg.wait_for_function("()=>{const v=document.querySelector(\"div[role='dialog'] video\");return v&&v.videoWidth>0}", timeout=15000)
            pg.locator("div[role='dialog'] button:has-text('촬영')").first.click()
            pg.wait_for_selector("div[role='dialog'] img[alt='1쪽']", timeout=8000)
            print("[mobile] ✅ 서류 촬영 모달 + 1장 촬영(폰 카메라 경로)")
            b.close()
    finally:
        stop_tree(server)  # 셸+node 트리째 종료(_procutil) — 전 OS 고아 프리뷰 방지
    print("\n===== mobile-smoke 결과 =====")
    if not issues:
        print("✅ 모바일 이슈 0건(가로오버플로·에러 없음)"); return 0
    print(f"❌ {len(issues)}건:")
    for i in issues[:15]:
        print("  ", i)
    return 1


if __name__ == "__main__":
    sys.exit(main())
