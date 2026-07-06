# -*- coding: utf-8 -*-
"""
비주얼킷.html 의 카드들을 기획서용 PNG로 자동 렌더링합니다.

사용법
------
  cd docs/기획서자료
  python render_assets.py            # (Windows는 render.bat 더블클릭)

무엇을 하나요
-------------
- 비주얼킷.html 을 브라우저로 열어 각 카드를 고해상도(2x) PNG로 저장합니다.
- _preview/card1..N.png      : 카드별 미리보기(확인용)
- 기획서가 참조하는 실제 파일명(chart1-…, diagram1-… 등)으로도 함께 저장

수정하려면
----------
  비주얼킷.html 상단의  const DATA = { ... }  블록의 숫자·글자만 고치고
  이 스크립트를 다시 실행하면 모든 PNG가 새로 만들어집니다.
  (PDF 한 벌이 필요하면 비주얼킷.html 을 브라우저로 열고 '🖨️ 인쇄·PDF' 버튼)

필요 패키지: playwright  (pip install playwright && playwright install chromium)
"""
import pathlib
import sys

# Windows 콘솔(cp949)에서도 한글·기호가 깨지지 않게 출력 인코딩을 UTF-8로.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = pathlib.Path(__file__).resolve().parent
KIT = HERE / "비주얼킷.html"
PREVIEW = HERE / "_preview"

# 카드 순서(비주얼킷.html 렌더 순서) → 기획서가 쓰는 실제 파일명.
# 한 카드를 여러 이름으로 저장할 수 있습니다(리스트).
CARD_FILES = {
    1: ["infographic-핵심지표.png"],
    2: ["chart1-출처구성.png"],
    3: ["chart2-카테고리분포.png"],
    4: ["diagram2-AI검색흐름.png"],
    5: ["diagram1-아키텍처.png"],
    6: ["diagram5-LangGraph10노드.png"],
    7: ["chart3-발급자동화.png", "diagram3-발급자동화.png"],
    8: ["chart4-경쟁비교.png"],
}


def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("playwright 가 없습니다 →  pip install playwright && playwright install chromium")

    PREVIEW.mkdir(exist_ok=True)
    saved = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        # deviceScaleFactor=2 → 인쇄·PPT에서도 또렷한 고해상도.
        page = browser.new_page(viewport={"width": 1120, "height": 900}, device_scale_factor=2)
        page.goto(KIT.as_uri())
        # 웹폰트(Pretendard)·SVG 렌더가 끝날 시간을 줍니다(폰트 깨짐 방지).
        page.wait_for_load_state("networkidle")
        try:
            page.evaluate("document.fonts.ready")
        except Exception:
            pass
        page.wait_for_timeout(700)

        cards = page.query_selector_all(".card")
        print(f"카드 {len(cards)}장 발견 — PNG로 저장합니다…")
        for i, card in enumerate(cards, start=1):
            preview = PREVIEW / f"card{i}.png"
            card.screenshot(path=str(preview))
            saved += 1
            names = CARD_FILES.get(i, [])
            for name in names:
                dest = HERE / name
                card.screenshot(path=str(dest))
                saved += 1
                print(f"  ✓ card{i} → {name}")
            if not names:
                print(f"  · card{i} → (미리보기만)")

        # 한 장 요약 포스터도 다시 렌더(위에서 만든 최신 차트를 그대로 삽입).
        poster = HERE / "기획서-한장요약.html"
        if poster.exists():
            pg = browser.new_page(viewport={"width": 1200, "height": 1600}, device_scale_factor=2)
            pg.goto(poster.as_uri())
            pg.wait_for_load_state("networkidle")
            pg.wait_for_timeout(500)
            pg.screenshot(path=str(HERE / "기획서-한장요약.png"), full_page=True)
            saved += 1
            print("  ✓ 기획서-한장요약.png (포스터)")

        browser.close()
    print(f"\n완료: PNG {saved}개 저장 (폴더: {HERE})")


if __name__ == "__main__":
    main()
