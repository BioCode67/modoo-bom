"""🧠 AI 채움 실브라우저 e2e — 접근성 이름 인지 + 결정론 의미매칭이 '진짜 Chromium'에서
합성 정부폼(tr>th 라벨·주민번호 앞/뒷·휴대폰 앞자리 select+뒷자리 input·시도 select)을
LLM 키 없이 올바른 칸에 채우는지 검증. 유닛 mock이 놓친 실결함(placeholder select filled
오판·휴대폰 앞자리 select 오매칭)을 잡아낸 회귀 락.
"""
import asyncio
import glob

import pytest

_HTML = """<!doctype html><meta charset="utf-8"><body>
<table>
<tr><th>배우자 성명</th><td><input id="spouse" type="text"></td></tr>
<tr><th>성명</th><td><input id="nm" type="text"></td></tr>
<tr><th>주민등록번호</th><td><input id="b" type="text"> - <input id="r" type="password"></td></tr>
<tr><th>휴대폰 번호</th><td>
  <select id="h"><option>010</option><option>011</option></select>
  <input id="p" type="tel"></td></tr>
<tr><th>주민등록상 주소</th><td>
  <select id="sido"><option>시도 선택</option><option>경상북도</option><option>서울특별시</option></select></td></tr>
</table></body>"""


def _chromium_path():
    hits = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
    return hits[0] if hits else None


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_ai_fill_accessible_name_deterministic_real_browser(monkeypatch):
    monkeypatch.setenv("RPA_AI_FILL", "1")
    from playwright.async_api import async_playwright
    from rpa.ai_fill import ai_fill

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()
            await pg.set_content(_HTML)
            # LLM 키 없음 → 결정론 계층(접근성 이름)만으로 채워야 한다
            out = await ai_fill(pg, pg,
                                {"name": "김주형", "birth6": "010601", "phone_tail": "12345678", "sido": "경상북도"},
                                page_hint="합성 정부폼")
            vals = await pg.evaluate(
                "() => ({nm: document.getElementById('nm').value, b: document.getElementById('b').value,"
                " p: document.getElementById('p').value, sido: document.getElementById('sido').value,"
                " spouse: document.getElementById('spouse').value})")
            await b.close()
            return out, vals

    out, vals = asyncio.new_event_loop().run_until_complete(run())
    assert out.get("name") and out.get("birth6") and out.get("phone_tail") and out.get("sido")
    assert vals["nm"] == "김주형"           # 성명 textbox
    assert vals["b"] == "010601"            # 주민번호 '첫' textbox(앞자리)
    assert vals["p"] == "12345678"          # 휴대폰 뒷자리 input (앞자리 010 select 아님)
    assert vals["sido"] == "경상북도"        # 주소 select에서 실제 옵션 선택(placeholder 아님)
    assert vals["spouse"] == ""             # 🚫 '배우자 성명'(신청인 앞) 칸엔 신청인 이름이 안 들어감
