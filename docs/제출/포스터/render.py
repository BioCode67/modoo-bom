# -*- coding: utf-8 -*-
"""포스터세션 제출본 렌더러 — poster.html → 모두봄_포스터.pdf(70x140cm).

사용법: cd docs/제출/포스터 && python render.py
PPTX는 같은 PDF를 200DPI 래스터로 변환해 공식 양식(70x140cm) 1장에 전면 배치해 만든다
(양식 1페이지 안내는 삭제) — 두 파일이 화면상 완전히 동일하도록 보장.
"""
import glob
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "poster.html"
PDF = HERE / "모두봄_포스터.pdf"


def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        exe = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
        b = p.chromium.launch(executable_path=(exe[0] if exe else None))
        # 70cm x 140cm = 26.46in x 52.91in (1cm = 37.795px CSS)
        pg = b.new_page(viewport={"width": 2646, "height": 5292})
        pg.goto(SRC.as_uri(), wait_until="networkidle")
        pg.wait_for_timeout(2500)
        pg.pdf(path=str(PDF), width="70cm", height="140cm", print_background=True,
               margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
        b.close()
    print(f"완료: {PDF.name} ({PDF.stat().st_size/1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
