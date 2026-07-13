# -*- coding: utf-8 -*-
"""og-banner.html → public/og.png (1200x1200) 렌더. backend venv의 playwright 사용.
사용: (backend venv 활성 후) python frontend/scripts/render-og.py"""
import pathlib, sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "og-banner.html"
OUT = HERE.parent / "public" / "og.png"

def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1200, "height": 1200}, device_scale_factor=1)
        page.goto(SRC.as_uri())
        page.wait_for_load_state("networkidle")
        try:
            page.evaluate("document.fonts.ready")
        except Exception:
            pass
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT), clip={"x": 0, "y": 0, "width": 1200, "height": 1200})
        browser.close()
    print(f"저장: {OUT} ({OUT.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
