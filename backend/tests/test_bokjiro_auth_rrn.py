# -*- coding: utf-8 -*-
"""복지로 간편인증 자동입력 — 주민번호 뒷자리(password)까지 견고하게 채우는지 회귀 락.

실사용 제보(2026-07-21): 이름·생년월일·휴대폰은 자동입력되는데 '주민번호 뒷 7자리'만 안 들어가
로그인이 멈췄다("원래는 됐다"=회귀). 원인은 뒷자리 필 로직이 단순 click+type 1회라 포커스·재시도·
값검증이 없어 간헐 실패한 것. → 이름/생년월일/휴대폰과 동일한 견고한 _fill(focus_key/click_key/fill
3중 + 값일치 검증)로 통일. 이 테스트가 뒷자리까지 채워짐을 실Chromium으로 못 박는다.
"""
import asyncio
import glob

import pytest


def _chromium_path():
    hits = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
    return hits[0] if hits else None


# 복지로 간편인증 실측 레이아웃(스샷 2026-07-21): 이름 / 주민등록번호(앞6 text + 뒷7 password) / 휴대폰(010 select + tail)
_HTML = """<!doctype html><meta charset="utf-8"><body>
<div><span>이름</span><input id="nm" type="text"></div>
<div><span>주민등록번호</span><input id="b" type="text" maxlength="6"><input id="r" type="password" maxlength="7"></div>
<div><span>휴대폰 번호</span><select id="h"><option>010</option><option>011</option></select><input id="p" type="tel"></div>
</body>"""


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_bokjiro_auth_fills_rrn_back_real_browser():
    from playwright.async_api import async_playwright
    from rpa.apply_rpa import _autofill_bokjiro_auth

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()
            await pg.set_content(_HTML)
            await _autofill_bokjiro_auth([pg], pg, {
                "name": "김주형", "birth_date": "20010601", "phone": "01075504498", "rrn_back": "1234567"})
            vals = await pg.evaluate("() => ({nm: nm.value, b: b.value, r: r.value, p: p.value})")
            await b.close()
            return vals

    vals = asyncio.new_event_loop().run_until_complete(run())
    assert vals["nm"] == "김주형"      # 이름
    assert vals["b"] == "010601"       # 앞자리(생년월일 6)
    assert vals["p"] == "75504498"     # 휴대폰 뒷부분
    assert vals["r"] == "1234567"      # ⭐ 뒷자리(password) — 회귀 락(원래 이게 안 들어갔음)
