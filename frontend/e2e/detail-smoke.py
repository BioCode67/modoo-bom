# -*- coding: utf-8 -*-
"""모두봄 정책 상세 스모크 — 상세 드로어의 실사용 상호작용 라이브 회귀 검증.

검증:
  1) 탐색 → 정책 상세 열림, 페이지 에러 0
  2) '필요 서류' 체크리스트 존재 + 체크 토글 동작(aria-pressed 변경) — 전역 준비 기억 UX
  3) (체크리스트 있으면) 상세가 크래시 없이 렌더

배포 후 회귀 게이트. 종료코드 0=정상, 1=문제.
실행: backend/venv/Scripts/python.exe frontend/e2e/detail-smoke.py
"""
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

SITE = "https://biocode67.github.io/modoo-bom/"


def run() -> bool:
    perrs = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_context().new_page()
        pg.on("pageerror", lambda e: perrs.append(str(e)))
        pg.goto(SITE, wait_until="networkidle", timeout=60000)
        if pg.get_by_role("dialog").count():
            pg.keyboard.press("Escape"); pg.wait_for_timeout(400)

        pg.get_by_role("button", name="정책 둘러보기").first.click(timeout=8000)
        pg.wait_for_timeout(1500)
        for sel in ["text=자세히", "text=자세히 보기"]:
            if pg.locator(sel).count():
                pg.locator(sel).first.click(timeout=8000); break
        pg.wait_for_timeout(1500)

        has_docs = pg.locator("text=필요 서류").count() > 0
        print(f"필요 서류 섹션: {'있음' if has_docs else '없음'}")

        toggled = None
        chk = pg.locator("button[aria-label*='준비']")
        if chk.count():
            before = chk.first.get_attribute("aria-pressed")
            chk.first.click(); pg.wait_for_timeout(400)
            after = chk.first.get_attribute("aria-pressed")
            toggled = before != after
            print(f"서류 체크 토글: {before} → {after} ({'OK' if toggled else '변화없음'})")
        else:
            print("서류 체크 버튼 없음(이 정책은 required_docs 없음)")

        print(f"페이지(uncaught) 에러: {len(perrs)}")
        for e in perrs[:3]:
            print("  PAGEERR:", e[:140])
        b.close()

    # 게이트: 상세가 열리고(필요서류 섹션 존재) 에러 0. 토글은 서류 있을 때만 필수.
    return has_docs and len(perrs) == 0 and (toggled is not False)


if __name__ == "__main__":
    good = run()
    print("\nDETAIL SMOKE", "OK ✅" if good else "실패 ❌")
    sys.exit(0 if good else 1)
