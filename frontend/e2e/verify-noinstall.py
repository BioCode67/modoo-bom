# -*- coding: utf-8 -*-
"""무설치 자동 서류발급·신청 강화 E2E 검증 — 이번 변경 전용.

여정:
  1) 관심목록(기초연금) 시드 → 나의 복지 → 서류 준비 도우미 렌더
  2) 무설치 배너 CTA가 정부24 민원 딥링크(CappBizCD=13100000015)로 직결
  3) '발급 완료로 표시' 토글 → 완료 카드 표시 + 배너 카운트/다음 서류 진행('이어서 발급')
  4) 복귀 확인 배너(ReturnConfirm) — pendingReturn 후 focus 복귀 시 '발급을 완료하셨나요?' → '네' → 완료 기록

실행: cd frontend && <venv>/python.exe e2e/verify-noinstall.py  (npm run build -- --outDir e2e-dist 선행 또는 스크립트가 재사용)
"""
import io as _io
import json
import os
import socket
import subprocess

from _procutil import SPAWN_KW, stop_tree
import sys
import time
from pathlib import Path

sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

FRONTEND = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = free_port()
BASE = f"http://localhost:{PORT}/"


def wait_port(port: int, timeout: float = 30) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("localhost", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


SEED = {
    "state": {
        "tracked": [{
            "policyId": "POL-001", "name": "기초연금", "category": "노인",
            "status": "tracking", "savedAt": 1751760000000, "checkedDocs": [],
        }],
        "docDone": {},
        "elderly": False, "highContrast": False, "onboarded": True, "uiLang": "ko",
        "profile": None, "result": None,
    },
    "version": 0,
}


def main() -> int:
    # e2e-dist 재사용(스모크가 방금 빌드) — 없으면 빌드
    if not (FRONTEND / "e2e-dist" / "index.html").exists():
        print("[verify] e2e-dist 빌드 중 …")
        r = subprocess.run("npm run build -- --outDir e2e-dist --emptyOutDir --base /",
                           cwd=str(FRONTEND), shell=True)
        if r.returncode != 0:
            return 2

    log = open(os.path.join(str(FRONTEND), "e2e", "verify-preview.log"), "w", encoding="utf-8")
    server = subprocess.Popen(
        f"npm run preview -- --outDir e2e-dist --port {PORT} --strictPort",
        cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT,
        **SPAWN_KW,
    )
    try:
        if not wait_port(PORT, timeout=60):
            print("[verify] ❌ preview 서버가 뜨지 않음")
            return 1

        from playwright.sync_api import sync_playwright

        errors: list[str] = []
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=(__import__("glob").glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome") or [None])[0])
            ctx = browser.new_context()
            # 관심목록 시드 — 위저드 여정은 smoke가 커버, 여기선 서류 도우미에 직행
            # ⚠️ init script는 매 내비게이션마다 실행 — 최초 1회만 시드(이후 앱이 쓴 persist를 보존)
            ctx.add_init_script(
                f"try {{ if (!localStorage.getItem('modoobom-store')) localStorage.setItem('modoobom-store', {json.dumps(json.dumps(SEED, ensure_ascii=False))}) }} catch (e) {{}}"
            )
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))

            # 1) 나의 복지 → 서류 준비 도우미
            page.goto(BASE + "?go=my", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_selector("text=서류 준비 도우미", timeout=15000)
            print("[verify] ✅ 1. 서류 준비 도우미 렌더(기초연금 시드)")

            # 2) 무설치 배너 CTA = 등본 민원 딥링크 직결
            cta = page.locator("a:has-text('전자발급 시작')").first
            cta.wait_for(timeout=10000)
            href = cta.get_attribute("href") or ""
            assert "CappBizCD=13100000015" in href, f"배너 CTA가 등본 딥링크가 아님: {href}"
            assert "주민등록등본" in (cta.inner_text() or ""), "CTA에 서류명 미표기"
            page.wait_for_selector("text=수령방법", timeout=5000)  # 전자문서지갑 선택 힌트
            print("[verify] ✅ 2. 배너 CTA → 정부24 등본 민원 딥링크 + 수령방법 힌트")

            # 3) 발급 완료 토글 → 완료 표시 + 배너에서 제외
            page.locator("button[aria-label='주민등록등본 발급 완료로 표시']").click()
            page.wait_for_selector("text=발급 완료로 표시했어요", timeout=5000)
            cta2 = page.locator("a:has-text('전자발급 시작')")
            # 기초연금의 전자발급 서류는 등본 1종 → 완료 후 배너 자체가 사라져야 함(남은 0종)
            assert cta2.count() == 0, "완료 후에도 배너 CTA가 남아있음"
            print("[verify] ✅ 3. 발급 완료 기억(docDone) + 배너 진행")

            # 새로고침 후에도 기억(persist) — 앱이 ?go를 지우므로(replaceState) 재진입은 ?go=my로
            page.goto(BASE + "?go=my", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_selector("text=발급 완료로 표시했어요", timeout=10000)
            print("[verify] ✅ 3.5 새로고침 후에도 발급 완료 유지(persist)")

            # 되돌리기(다음 검증 위해)
            page.locator("button[aria-label='주민등록등본 발급 완료 표시 취소']").click()
            page.wait_for_selector("a:has-text('전자발급 시작')", timeout=5000)

            # 4) 복귀 확인 배너 — 20초 전 발급하러 나간 것으로 기록 후 focus 복귀
            page.evaluate(
                "sessionStorage.setItem('modoo:pendingReturn', JSON.stringify({kind:'doc', doc:'주민등록등본', at: Date.now()-20000}))"
            )
            page.evaluate("window.dispatchEvent(new Event('focus'))")
            page.wait_for_selector("text=발급을 완료하셨나요?", timeout=5000)
            page.locator("button:has-text('네, 발급했어요')").click()
            page.wait_for_selector("text=발급 완료로 표시했어요", timeout=5000)
            print("[verify] ✅ 4. 복귀 확인 배너 → '네' 1탭으로만 완료 기록(날조 없음)")

            assert not errors, f"pageerror: {errors[:3]}"
            browser.close()

        print("[verify] 🎉 무설치 발급 흐름 전 구간 통과")
        return 0
    finally:
        stop_tree(server)  # 셸+node 트리째 종료(_procutil) — npx kill-port 우회 불필요


if __name__ == "__main__":
    sys.exit(main())
