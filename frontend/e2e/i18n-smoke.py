# -*- coding: utf-8 -*-
"""모두봄 다국어 스모크 — 외국인 사각지대 기능(헤드라인 차별화)의 라이브 회귀 검증.

검증:
  1) 브라우저 언어가 외국어(vi-VN)면 최상단에 '자국어 사용' 제안 배너 노출 + 눌러서 전환 → 배너 사라짐
  2) 브라우저 언어가 한국어(ko-KR)면 제안 배너 미노출(나그 없음)
  3) 외국어 UI일 때 정책 상세에 '자국어로 번역' 링크(구글 번역) 존재
  4) 온보딩 모달이 외국인의 언어 배너를 가리지 않음(첫 방문 순서)

배포 후 회귀 게이트로 사용. 종료코드 0=정상, 1=문제.
실행: backend/venv/Scripts/python.exe frontend/e2e/i18n-smoke.py
"""
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

SITE = "https://biocode67.github.io/modoo-bom/"


def run() -> bool:
    ok = True
    with sync_playwright() as pw:
        b = pw.chromium.launch()

        # 1) 베트남어 로케일 — 배너 노출 + 전환
        ctx = b.new_context(locale="vi-VN")
        pg = ctx.new_page()
        perrs = []
        pg.on("pageerror", lambda e: perrs.append(str(e)))
        pg.goto(SITE, wait_until="networkidle", timeout=60000)
        pg.wait_for_timeout(800)
        vi_banner = pg.locator("text=Dùng tiếng Việt").count() > 0
        print(f"[vi-VN] 언어 제안 배너 노출: {'OK' if vi_banner else '실패'}")
        ok = ok and vi_banner
        if vi_banner:
            # 온보딩이 배너를 가리면 클릭이 막힘 → 가림 없이 눌려야 함(순서 보장 확인)
            pg.locator("text=Dùng tiếng Việt").first.click(timeout=8000)
            pg.wait_for_timeout(600)
            gone = pg.locator("text=Dùng tiếng Việt").count() == 0
            print(f"[vi-VN] 전환 후 배너 사라짐(온보딩 미가림): {'OK' if gone else '실패'}")
            ok = ok and gone
            # 전환 후 상세 열어 '번역' 링크 확인 — 탐색 → 첫 정책
            pg.get_by_role("button", name="정책 둘러보기").first.click(timeout=8000)
            pg.wait_for_timeout(1200)
            for sel in ["text=자세히", "text=자세히 보기"]:
                if pg.locator(sel).count():
                    pg.locator(sel).first.click(timeout=8000)
                    break
            pg.wait_for_timeout(1200)
            has_tr = pg.locator("a[href*='translate.google.com']").count() > 0
            print(f"[vi-VN] 상세에 자국어 번역 링크: {'OK' if has_tr else '실패'}")
            ok = ok and has_tr
        ctx.close()

        # 2) 한국어 로케일 — 배너 미노출
        ctx2 = b.new_context(locale="ko-KR")
        pg2 = ctx2.new_page()
        pg2.goto(SITE, wait_until="networkidle", timeout=60000)
        pg2.wait_for_timeout(800)
        ko_banner = pg2.locator("text=Dùng tiếng Việt, text=Use English").count() > 0
        print(f"[ko-KR] 제안 배너 미노출: {'OK' if not ko_banner else '실패(한국어에 뜸)'}")
        ok = ok and not ko_banner
        ctx2.close()

        print(f"페이지(uncaught) 에러: {len(perrs)}")
        ok = ok and len(perrs) == 0
        b.close()
    return ok


if __name__ == "__main__":
    good = run()
    print("\nI18N SMOKE", "OK ✅" if good else "실패 ❌")
    sys.exit(0 if good else 1)
