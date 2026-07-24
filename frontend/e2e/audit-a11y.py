# -*- coding: utf-8 -*-
"""접근성(axe-core) 실브라우저 감사 — 전 화면 위반 0을 회귀로 고정한다.

왜 스위트로 두나: 편의성(접근성)은 본 서비스의 핵심 약속(큰글씨·고대비·음성·TTS)인데,
마크업 변경 한 번에 조용히 깨진다(예: 헤딩 레벨 점프 — 실제로 h1→h3 점프를 이 감사로 발견).
axe-core 기본 룰셋(WCAG 2 A/AA + best-practice)을 4개 화면 + 고대비·큰글씨 모드 + 통화에 돌려
위반이 하나라도 나오면 실패한다.

⚠️ 측정 유효성 게이트: 각 화면에서 '앱이 실제로 마운트됐는지'를 먼저 확인한다 —
빈 페이지를 감사하면 위반이 적게 나와 '통과처럼 보이는' 무효 측정이 된다(실제 겪은 함정).

실행(레포 루트에서):
    cd frontend && python e2e/audit-a11y.py
필요: npm i (axe-core는 devDependency) · playwright(파이썬)
"""
import glob
import io as _io
import os
import socket
import subprocess

from _procutil import SPAWN_KW, stop_tree
import sys
from pathlib import Path

sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
FRONTEND = Path(__file__).resolve().parents[1]
OUT_DIR = "e2e-dist-a11y"

SEED = ("localStorage.setItem('modoobom-store',JSON.stringify({state:{onboarded:true,langSuggested:true,"
        "tracked:[{policyId:'POL-001',name:'기초연금',category:'노인',status:'tracking',savedAt:1752700000000,checkedDocs:[]}]},version:0}))")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_port(port: int, timeout: float = 30) -> bool:
    import time
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("localhost", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.4)
    return False


def main() -> int:
    axe_path = FRONTEND / "node_modules" / "axe-core" / "axe.min.js"
    if not axe_path.exists():
        print("[a11y] ❌ axe-core 미설치 — frontend에서 npm i 후 재실행")
        return 2
    axe_js = axe_path.read_text(encoding="utf-8")

    port = free_port()
    log = open(FRONTEND / "e2e" / "preview.log", "a", encoding="utf-8")
    print(f"[a11y] {OUT_DIR} 빌드 중 …")
    r = subprocess.run(f"npm run build -- --outDir {OUT_DIR} --emptyOutDir --base /",
                       cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT)
    if r.returncode != 0:
        print("[a11y] ❌ 빌드 실패 — e2e/preview.log 확인")
        return 2
    print(f"[a11y] vite preview 기동(:{port}) …")
    server = subprocess.Popen(f"npm run preview -- --outDir {OUT_DIR} --port {port} --strictPort",
                              cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT, **SPAWN_KW)
    failed = 0
    try:
        if not wait_port(port):
            print("[a11y] ❌ preview 서버가 뜨지 않음")
            return 1
        from playwright.sync_api import sync_playwright
        exe = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=(exe[0] if exe else None))
            ctx = b.new_context(viewport={"width": 1280, "height": 800})
            ctx.add_init_script(SEED)
            cases = [
                ("home", "", None),
                ("analyze", "?go=analyze", None),
                ("explore", "?go=explore", None),
                ("my", "?go=my", None),
                ("home·고대비", "", "고대비(저시력용) 모드"),
                ("home·큰글씨", "", "큰 글씨(어르신용) 모드"),  # 어르신 확대 규칙(.text-xs 오버라이드 등) 적용 상태의 대비·구조 룰
                ("통화", "", None),  # 📞 통화 다이얼로그 오픈 상태 — 대화 표면도 axe 커버(셀렉트·마이크·이중 경로)
                ("음성사용법", "", None),  # 🔊 음성 사용법 안내 다이얼로그 — 낭독 자막·큰 버튼·진행칩 axe 커버
            ]
            for name, q, toggle in cases:
                pg = ctx.new_page()
                pg.goto(f"http://localhost:{port}/{q}", wait_until="domcontentloaded")
                pg.wait_for_timeout(2200)
                if toggle:  # 접근성 모드 팔레트에서의 룰까지 — 토글 버튼으로 실제 사용 경로 그대로
                    pg.get_by_role("button", name=toggle).click()
                    pg.wait_for_timeout(500)
                mounted = pg.evaluate(
                    "() => (document.getElementById('root')?.childElementCount ?? 0) > 0 && document.body.innerText.length > 200")
                if not mounted:
                    print(f"[a11y] ❌ {name}: 앱 미마운트 — 감사 무효(서빙/번들 문제)")
                    failed += 1
                    pg.close()
                    continue
                if name == "통화":  # 다이얼로그를 실제 사용 경로(챗 헤더 📞)로 연다
                    pg.click('[aria-label="복지 도우미 챗봇 열기"]')
                    pg.click('[aria-label="음성 통화 상담으로 전환"]')
                    pg.wait_for_selector('[role="dialog"][aria-label="새싹이와 통화 상담"]', timeout=8000)
                    pg.wait_for_timeout(600)
                if name == "음성사용법":  # 내비의 '음성으로 사용법 듣기' 버튼으로 실제 경로 그대로 연다
                    pg.click('[aria-label="음성으로 사용법 듣기"]')
                    pg.wait_for_selector('[role="dialog"][aria-label="음성 사용법 안내"]', timeout=8000)
                    pg.wait_for_timeout(600)
                pg.evaluate(axe_js)
                res = pg.evaluate("async () => await axe.run(document, {resultTypes:['violations']})")
                vio = res["violations"]
                if vio:
                    failed += 1
                    print(f"[a11y] ❌ {name}: 위반 {len(vio)}종")
                    for v in vio:
                        tgt = v["nodes"][0]["target"][0] if v["nodes"] and v["nodes"][0]["target"] else ""
                        print(f"     - {v['impact']}: {v['id']} ×{len(v['nodes'])} ({str(tgt)[:70]})")
                else:
                    print(f"[a11y] ✅ {name}: 위반 0")
                pg.close()
            b.close()
    finally:
        stop_tree(server)  # 셸+node 트리째 종료(_procutil) — 전 OS 고아 프리뷰 방지
    print("\n===== a11y 감사 결과 =====")
    if failed:
        print(f"❌ {failed}개 화면에서 위반/무효 — 위 로그 확인")
        return 1
    print("🎉 전 화면(기본 4 + 고대비·큰글씨 + 통화) axe 위반 0 — 접근성 회귀 없음")
    return 0


if __name__ == "__main__":
    sys.exit(main())
