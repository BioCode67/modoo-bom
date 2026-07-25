"""🧠 발급 폼 자가 치유 — 실브라우저로 '정체 폼'이 사람 개입 없이 복구되는지 검증.

정체 상황(필수 목적 select 미선택 + 성명칸 빈칸)을 합성 폼으로 만들고, _self_heal_doc_form이
① 필수 select를 '관공서제출용'으로 재선택 ② 결정론 매칭으로 성명칸을 채우는지 확인(LLM 키 없이도).
"""
import asyncio
import glob

import pytest

_HTML = """<!doctype html><meta charset="utf-8"><body>
<table>
<tr><th>성명</th><td><input id="nm" type="text"></td></tr>
<tr><th>발급 목적</th><td>
  <select id="purpose"><option value="">선택하세요</option><option>기타</option><option>관공서제출용</option></select></td></tr>
</table></body>"""


def _chromium_path():
    hits = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
    return hits[0] if hits else None


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_self_heal_recovers_stuck_doc_form(monkeypatch):
    monkeypatch.setenv("RPA_AI_FILL", "1")  # 밸브 on(키 없어도 결정론 계층 동작)
    from playwright.async_api import async_playwright
    from rpa.gov24_rpa import _self_heal_doc_form

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()
            await pg.set_content(_HTML)
            healed = await _self_heal_doc_form(pg, "주민등록등본",
                                               {"name": "김주형", "birth_date": "20010601", "phone": "01012345678"})
            vals = await pg.evaluate(
                "() => ({nm: document.getElementById('nm').value, purpose: document.getElementById('purpose').value})")
            await b.close()
            return healed, vals

    healed, vals = asyncio.new_event_loop().run_until_complete(run())
    # ① 필수 select가 '관공서제출용'으로 재선택됨(정체 원인 해소)
    assert vals["purpose"] == "관공서제출용"
    # ② 성명 빈칸이 결정론 매칭으로 채워짐(키 없이도)
    assert vals["nm"] == "김주형"
    # ③ 무엇을 보정했는지 사용자에게 알릴 요약이 남는다(값은 없음)
    assert "필수 선택 재적용" in healed and "빈 입력칸 보정" in healed
