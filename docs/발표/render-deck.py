# -*- coding: utf-8 -*-
"""본선 발표자료 초안(HTML)을 16:9 PDF와 장별 PNG(검토용)로 렌더링합니다.

사용법:  cd docs/발표 && python render-deck.py
출력:   본선-발표자료-초안.pdf  ·  _preview/slide1..N.png
텍스트 수정은 본선-발표자료-초안.html에서 직접 → 이 스크립트 재실행.
"""
import glob
import pathlib
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "본선-발표자료-초안.html"
PDF = HERE / "본선-발표자료-초안.pdf"
PREVIEW = HERE / "_preview"


def main():
    from playwright.sync_api import sync_playwright
    PREVIEW.mkdir(exist_ok=True)
    with sync_playwright() as p:
        exe = glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')
        b = p.chromium.launch(executable_path=(exe[0] if exe else None))
        pg = b.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=2)
        pg.goto(SRC.as_uri())
        pg.wait_for_load_state("networkidle")
        try:
            pg.evaluate("document.fonts.ready")
        except Exception:
            pass
        pg.wait_for_timeout(600)
        slides = pg.query_selector_all("section.slide")
        print(f"슬라이드 {len(slides)}장 — PNG 미리보기 저장…")
        for i, s in enumerate(slides, start=1):
            s.scroll_into_view_if_needed()
            pg.wait_for_timeout(120)
            s.screenshot(path=str(PREVIEW / f"slide{i}.png"))
            print(f"  ✓ slide{i}.png")
        pg.pdf(path=str(PDF), width="1280px", height="720px", print_background=True,
               margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
        b.close()
    print(f"\n완료: {PDF.name} + _preview/slide*.png")


if __name__ == "__main__":
    main()
