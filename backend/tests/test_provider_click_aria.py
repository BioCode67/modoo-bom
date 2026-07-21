# -*- coding: utf-8 -*-
"""복지로 간편인증 제공자 선택 — aria-label로만 이름을 주는 로고 링크에서 카카오톡 클릭 회귀 락.

실사용 제보(2026-07-21, 로컬): 복지로 제공자 타일은 가시 텍스트·img alt 없이 aria-label='카카오톡'으로만
이름을 준다(흐름기록: name 있고 text 없음). 기존 클릭 3단계(셀렉터/토큰/느슨) 어디도 aria-label 을 안 봐서
카카오톡이 안 눌렸다(정부24는 텍스트/alt가 있어 됐음). → 3단계 모두 aria-label 매칭 추가. '카카오뱅크'
(aria-label='카카오뱅크')는 '카카오톡'을 포함하지 않아 오클릭되지 않음을 함께 검증.
"""
import asyncio
import glob

import pytest


def _chromium_path():
    hits = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
    return hits[0] if hits else None


_HTML = """<!doctype html><meta charset="utf-8"><body><div class="grid">
  <a aria-label="카카오뱅크" style="display:inline-block;width:60px;height:60px" onclick="window.__c='카카오뱅크';return false"><img></a>
  <a aria-label="토스" style="display:inline-block;width:60px;height:60px" onclick="window.__c='토스';return false"><img></a>
  <a aria-label="카카오톡" style="display:inline-block;width:60px;height:60px" onclick="window.__c='카카오톡';return false"><img></a>
  <a aria-label="네이버" style="display:inline-block;width:60px;height:60px" onclick="window.__c='네이버';return false"><img></a>
</div></body>"""


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_provider_click_matches_aria_label_only_kakao():
    from playwright.async_api import async_playwright
    from rpa.base import click_provider_in_anyid

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()
            await pg.set_content(_HTML)
            r = await click_provider_in_anyid(pg, "kakao")
            clicked = await pg.evaluate("() => window.__c || ''")
            await b.close()
            return r, clicked

    r, clicked = asyncio.new_event_loop().run_until_complete(run())
    assert clicked == "카카오톡", f"aria-label 카카오톡을 눌러야: {clicked!r}"  # ← 회귀 락(가시텍스트/alt 없음)
