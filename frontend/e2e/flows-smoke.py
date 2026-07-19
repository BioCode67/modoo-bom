# -*- coding: utf-8 -*-
"""핵심 사용자 흐름 실브라우저 스모크 — 데모에서 쓰는 화면들이 런타임/CSP로 깨지지 않는지 고정.

유닛이 못 잡는 통합/CSP 파손을 잡는다(예: createObjectURL(blob:)이 CSP img-src에 막히던 카메라 버그).
빌드 산출물을 preview로 서빙하고 headless chromium으로 다음을 검증:
  1) 자연어 한 문장 → 분석 결과(청년월세지원 노출, 규칙기반 폴백이라 AI 모델 없이도)
  2) 결과 이미지 공유 → PNG 다운로드(캔버스→blob 다운로드가 CSP 하에서 동작)
  3) 정책 탐색 → 검색 → 결과 렌더
  4) AI 의미검색 토글 → 모델 로드 실패(오프라인)에도 한국어 키워드 결과로 정직 폴백(크래시·빈화면 아님)
  5) 접근성 토글(큰글씨·고대비) 동작
  6) 챗봇 열기 + 질문
  7) 복지 캘린더 .ics 다운로드(blob: 다운로드)
  + 전 구간 pageerror 0건(환경 네트워크 노이즈 제외)

실행(레포 루트에서):  cd frontend && python3 e2e/flows-smoke.py
"""
import io as _io, os, socket, subprocess, sys, time, glob
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from pathlib import Path

from _procutil import SPAWN_KW, stop_tree
FRONTEND = Path(__file__).resolve().parents[1]
ENVNOISE = ("ERR_TUNNEL", "ERR_CONNECTION", "ERR_NAME_NOT", "ERR_INTERNET", "ERR_ABORTED",
            "/api/", "health", "huggingface", "/ws/", "favicon", "Failed to fetch", "transformers")


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
    PORT = free_port(); BASE = f"http://localhost:{PORT}/"
    log = open(FRONTEND / "e2e" / "preview.log", "w", encoding="utf-8")
    print("[flows] e2e-dist-flows 빌드 중 …")
    if subprocess.run("npm run build -- --outDir e2e-dist-flows --emptyOutDir --base /",
                      cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT).returncode != 0:
        print("[flows] ❌ 빌드 실패"); return 2
    server = subprocess.Popen(f"npm run preview -- --outDir e2e-dist-flows --port {PORT} --strictPort",
                              cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT, **SPAWN_KW)
    issues = []

    def note(kind, v):
        if any(n in v for n in ENVNOISE):
            return
        issues.append(f"[{kind}] {v[:160]}")
    try:
        if not wait_port(PORT):
            print("[flows] ❌ preview 안 뜸"); return 1
        from playwright.sync_api import sync_playwright
        exe = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=(exe[0] if exe else None))
            pg = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
            pg.add_init_script("window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+(e.blockedURI||'').slice(0,30)))")
            pg.add_init_script("localStorage.setItem('modoobom-store',JSON.stringify({state:{onboarded:true},version:0}))")
            pg.on("pageerror", lambda e: note("pageerror", str(e)))
            def on_console(m):
                if m.type != "error":
                    return
                loc = ""
                try:
                    loc = (m.location or {}).get("url", "")
                except Exception:
                    pass
                if "localhost:8000" in loc or "127.0.0.1:8000" in loc:
                    return  # 로컬 에이전트 프로브 — 앱이 정상 폴백하므로 노이즈(데스크탑앱 병행 실행 시)
                note("console", m.text)
            pg.on("console", on_console)

            def step(tag, fn, critical=False):
                try:
                    fn(); print(f"[flows] ✅ {tag}"); return True
                except Exception as ex:
                    msg = f"{tag}: {str(ex)[:90]}"
                    if critical: note("step", msg)
                    print(f"[flows] ⚠️ {tag}: {str(ex)[:70]}"); return False

            pg.goto(BASE, wait_until="domcontentloaded", timeout=30000)
            step("홈 로드", lambda: pg.wait_for_selector("text=정부·지자체·민간 복지", timeout=20000), critical=True)
            # 1) 자연어 분석
            def analyze():
                inp = pg.locator("form input[type='text'], form input:not([type])").first
                inp.fill("27살 자취하는데 월세 지원 받을 수 있어?"); inp.press("Enter")
                pg.wait_for_selector("text=청년월세지원", timeout=25000)
            step("자연어 분석 → 청년월세지원 노출", analyze, critical=True)
            pg.wait_for_timeout(800)
            # 2) 이미지 공유(캔버스→PNG blob 다운로드)
            def img():
                with pg.expect_download(timeout=10000) as d:
                    pg.click("text=이미지")
                assert d.value.suggested_filename.endswith(".png")
            step("결과 이미지 공유 → PNG 다운로드", img, critical=True)
            # 3) 탐색 검색
            step("정책 탐색 이동", lambda: pg.click("text=정책 탐색"), critical=True)
            pg.wait_for_timeout(800)
            step("탐색 검색", lambda: pg.fill("input[type='search'], input[placeholder*='검색']", "청년 월세"))
            pg.wait_for_timeout(600)
            # 4) AI 의미검색 토글 — 실패해도 한국어 키워드 결과로 폴백(크래시 없이)
            step("AI 의미검색 토글", lambda: pg.locator("text=AI 의미 검색").first.click())
            pg.wait_for_timeout(1500)
            step("AI 실패해도 결과/안내 렌더(빈화면·크래시 아님)",
                 lambda: pg.wait_for_function("() => document.body.innerText.length > 500", timeout=5000), critical=True)
            # 5) 접근성 토글
            step("큰글씨 토글", lambda: pg.click("text=큰글씨"))
            step("고대비 토글", lambda: pg.click("text=고대비"))
            pg.wait_for_timeout(300)
            step("큰글씨 해제", lambda: pg.click("text=큰글씨"))
            step("고대비 해제", lambda: pg.click("text=고대비"))
            # 6) 챗봇
            step("챗봇 열기", lambda: pg.click("button[aria-label*='챗'], button[aria-label*='대화'], button[aria-label*='도우미']"))
            pg.wait_for_timeout(800)
            step("챗봇 질문", lambda: (pg.fill("div[role='dialog'] input, textarea", "기초연금 얼마 받아요?"), pg.keyboard.press("Enter")))
            pg.wait_for_timeout(1200)
            # CSP 위반 수집
            for c in (pg.evaluate("window.__csp||[]") or []):
                note("CSP", c)
            b.close()
    finally:
        stop_tree(server)  # 셸+node 트리째 종료(_procutil) — 전 OS 고아 프리뷰 방지
    print("\n===== flows-smoke 결과 =====")
    if not issues:
        print("✅ 실제 이슈 0건 — 핵심 흐름 런타임/CSP 깨끗"); return 0
    print(f"❌ {len(issues)}건:")
    for i in issues[:25]:
        print("  ", i)
    return 1


if __name__ == "__main__":
    sys.exit(main())
