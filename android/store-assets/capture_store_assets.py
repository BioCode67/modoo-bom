# -*- coding: utf-8 -*-
"""플레이스토어 등록 자산 자동 생성.

- feature-graphic.png : 특성 그래픽 1024x500 (등록 필수)
- screenshot-1..N.png : 폰 스크린샷 (라이브 사이트 실화면, 1080x2340)

사용법:  python capture_store_assets.py
"""
import pathlib
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = pathlib.Path(__file__).resolve().parent
LIVE = "https://biocode67.github.io/modoo-bom/"

# (파일명, 이동 액션 설명, ?go= 딥링크)
SCREENS = [
    ("screenshot-1-home.png", "홈", ""),
    ("screenshot-2-analyze.png", "내 복지 찾기", "?go=analyze"),
    ("screenshot-3-explore.png", "정책 탐색", "?go=explore"),
    ("screenshot-4-my.png", "나의 복지", "?go=my"),
]


def main():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ① 특성 그래픽 1024x500
        page = browser.new_page(viewport={"width": 1024, "height": 500}, device_scale_factor=1)
        page.goto((HERE / "feature-graphic.html").as_uri())
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(600)
        page.screenshot(path=str(HERE / "feature-graphic.png"))
        print("✓ feature-graphic.png (1024x500)")

        # ② 폰 스크린샷 (Pixel 급 뷰포트, 2.5x → 1080x2340)
        for name, label, go in SCREENS:
            pg = browser.new_page(viewport={"width": 432, "height": 936}, device_scale_factor=2.5,
                                  is_mobile=True, has_touch=True,
                                  user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")
            pg.goto(LIVE + go)
            pg.wait_for_load_state("networkidle")
            pg.wait_for_timeout(2500)  # 3D/애니메이션 안정화
            pg.screenshot(path=str(HERE / name))
            print(f"✓ {name} ({label})")
            pg.close()

        browser.close()
    print("\n완료 — 이 폴더의 PNG를 플레이 콘솔 '스토어 등록정보'에 업로드하세요.")


if __name__ == "__main__":
    main()
