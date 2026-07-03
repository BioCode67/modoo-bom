# -*- coding: utf-8 -*-
"""모두봄 E2E 스모크 — 실브라우저로 핵심 사용자 여정을 검증한다.

유닛테스트가 못 잡는 통합 파손(라우팅·번들·런타임 에러·화면 조립)을 데모 전에 잡는 안전망.
빌드 산출물(dist)을 vite preview로 띄우고 headless chromium으로 검증한다.

실행(레포 루트에서):
    cd frontend && npm run build   # dist 최신화
    ..\\backend\\venv\\Scripts\\python.exe e2e\\smoke.py

검증 여정:
  1) 홈 로드 + 히어로 통계(정부·지자체·민간)
  2) 복지 찾기 → 데모 페르소나(독거 어르신) → 분석 결과 + 민간재단 💝 섹션
  3) 챗 에이전트 열기 → 개인화 인사(프로필 이름)
  4) 정책 탐색 → 민간재단 필터 → 현대차 정몽구 스칼러십 노출
  + 전 구간 페이지 에러(pageerror) 0건
"""
import socket
import subprocess
import sys
import time
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1]
PORT = 4173
BASE = f"http://localhost:{PORT}/modoo-bom/"


def wait_port(port: int, timeout: float = 30) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket() as s:
            s.settimeout(1)
            try:
                s.connect(("127.0.0.1", port))
                return True
            except OSError:
                time.sleep(0.5)
    return False


def main() -> int:
    if not (FRONTEND / "dist" / "index.html").exists():
        print("[e2e] dist 없음 — 먼저 `npm run build` 를 실행하세요")
        return 2

    print(f"[e2e] vite preview 기동(:{PORT}) …")
    server = subprocess.Popen(
        f"npm run preview -- --port {PORT} --strictPort",
        cwd=str(FRONTEND), shell=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        if not wait_port(PORT):
            print("[e2e] ❌ preview 서버가 뜨지 않음")
            return 1

        from playwright.sync_api import sync_playwright

        errors: list[str] = []
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))

            # 1) 홈
            page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_selector("text=정부·지자체·민간 복지", timeout=15000)
            print("[e2e] ✅ 1. 홈 로드 + 히어로 통계")

            # 2) 분석: 복지 찾기 → 데모 페르소나 → 결과
            page.click("text=복지 찾기")
            page.click("text=독거 어르신")
            page.wait_for_selector("text=맞춤 추천 복지", timeout=30000)  # 분석 연출 ~3초 포함
            page.wait_for_selector("text=민간재단 지원", timeout=10000)
            print("[e2e] ✅ 2. 분석 결과 + 민간재단 💝 섹션")

            # 3) 챗 에이전트: 개인화 인사(분석한 프로필 이름)
            page.click('[aria-label="복지 도우미 챗봇 열기"]')
            page.wait_for_selector("text=김복순", timeout=10000)
            print("[e2e] ✅ 3. 챗 에이전트 개인화 브리핑")
            page.keyboard.press("Escape")

            # 4) 탐색: 민간재단 필터 → 큐레이션 노출
            page.click("text=정책 탐색")
            page.click("text=민간재단")
            page.wait_for_selector("text=현대차 정몽구 스칼러십", timeout=15000)
            print("[e2e] ✅ 4. 탐색 민간재단 필터 + 큐레이션 노출")

            browser.close()

        if errors:
            print(f"[e2e] ❌ 페이지 에러 {len(errors)}건:")
            for e in errors[:5]:
                print("   ", e[:200])
            return 1
        print("[e2e] 🎉 스모크 전 구간 통과 (페이지 에러 0)")
        return 0
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()


if __name__ == "__main__":
    sys.exit(main())
