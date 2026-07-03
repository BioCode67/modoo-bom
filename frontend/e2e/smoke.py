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
  5) 모바일 뷰포트(390px) 홈·복지찾기 진입
  + 전 구간 페이지 에러(pageerror) 0건
"""
import io as _io
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

# Windows 콘솔(cp949)에서도 이모지 출력이 죽지 않게 UTF-8 강제
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

FRONTEND = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = free_port()  # 고정 포트 충돌(좀비 프리뷰 등) 회피
BASE = f"http://localhost:{PORT}/"  # e2e-dist는 --base / 로 빌드(vite preview가 serve 모드 base(/)로 서빙하므로)


def wait_port(port: int, timeout: float = 30) -> bool:
    """vite가 IPv6(::1)로만 바인딩하기도 하므로 localhost 해석(v4/v6 모두)으로 확인"""
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("localhost", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def main() -> int:
    # 전용 출력 폴더(e2e-dist)로 직접 빌드 — 같은 폴더에서 병행 작업(다른 세션)의
    # dist 빌드와 경합해 index.html/assets가 어긋나는 문제를 원천 차단한다.
    print("[e2e] e2e-dist 빌드 중 …")
    log = open(os.path.join(str(FRONTEND), "e2e", "preview.log"), "w", encoding="utf-8")
    r = subprocess.run(
        "npm run build -- --outDir e2e-dist --emptyOutDir --base /",
        cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT,
    )
    if r.returncode != 0:
        print("[e2e] ❌ 빌드 실패 — e2e/preview.log 확인")
        return 2

    print(f"[e2e] vite preview 기동(:{PORT}) …")
    server = subprocess.Popen(
        f"npm run preview -- --outDir e2e-dist --port {PORT} --strictPort",
        cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT,
    )
    try:
        if not wait_port(PORT, timeout=60):
            print("[e2e] ❌ preview 서버가 뜨지 않음")
            return 1

        from playwright.sync_api import sync_playwright

        errors: list[str] = []
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
            bad: list[str] = []
            page.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
            page.on("requestfailed", lambda r: bad.append(f"FAIL {r.url} {r.failure}"))

            def dump(tag: str):
                """실패 원인 진단 — 페이지 에러·스크린샷 저장"""
                print(f"[e2e][debug] url={page.url} title={page.title()!r}")
                try:
                    kids = page.evaluate("document.getElementById('root')?.childElementCount")
                    entry = page.evaluate("performance.getEntriesByType('resource').length")
                    print(f"[e2e][debug] #root children={kids} resources={entry}")
                except Exception as ex:
                    print("[e2e][debug] evaluate 실패:", ex)
                for b in bad[:8]:
                    print("   [net]", b[:200])
                for e in errors[:6]:
                    print("   [pageerror]", e[:220])
                shot = FRONTEND / "e2e" / f"fail-{tag}.png"
                page.screenshot(path=str(shot))
                print(f"[e2e][debug] 스크린샷: {shot}")

            # 1) 홈
            page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
            try:
                page.wait_for_selector("text=정부·지자체·민간 복지", timeout=15000)
            except Exception:
                dump("home")
                raise
            print("[e2e] ✅ 1. 홈 로드 + 히어로 통계")

            # 첫 방문 온보딩 모달이 클릭을 가로채므로 닫는다(있을 때만)
            try:
                page.click('[aria-label="닫기"]', timeout=3000)
            except Exception:
                pass

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

            # 5) 모바일 뷰포트(iPhone급) — 핸드폰에서 홈·주 흐름이 깨지지 않는지
            mpage = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            mpage.on("pageerror", lambda e: errors.append(f"[mobile] {e}"))
            mpage.goto(BASE, wait_until="domcontentloaded", timeout=30000)
            mpage.wait_for_selector("text=정부·지자체·민간 복지", timeout=15000)
            try:
                mpage.click('[aria-label="닫기"]', timeout=3000)
            except Exception:
                pass
            mpage.click('[aria-label="하단 메뉴"] >> text=복지 찾기')  # 모바일은 하단 탭바(데스크탑 nav는 hidden)
            mpage.wait_for_selector("text=독거 어르신", timeout=10000)
            print("[e2e] ✅ 5. 모바일(390px) 홈·복지찾기 정상")
            mpage.close()

            browser.close()

        if errors:
            print(f"[e2e] ❌ 페이지 에러 {len(errors)}건:")
            for e in errors[:5]:
                print("   ", e[:200])
            return 1
        print("[e2e] 🎉 스모크 전 구간 통과 (페이지 에러 0)")
        return 0
    finally:
        # Windows에서 terminate()는 npm 래퍼만 죽이고 node 자식이 살아남음 → 프로세스 트리째 종료
        if os.name == "nt":
            subprocess.run(f"taskkill /F /T /PID {server.pid}", shell=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()


if __name__ == "__main__":
    sys.exit(main())
