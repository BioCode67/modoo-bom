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


# 신청인 칸이 '이미 채워진' 복지로형 다인 폼(신청인·가구원·배우자 섹션 공존) — 캐스케이드 오입력 재현용
_HTML_MULTI = """<!doctype html><meta charset="utf-8"><body>
<table>
<tr><th>신청인 성명</th><td><input id="anm" type="text" value="김주형"></td></tr>
<tr><th>신청인 휴대폰</th><td><input id="aph" type="tel" value="12345678"></td></tr>
<tr><th>가구원 성명</th><td><input id="gnm" type="text"></td></tr>
<tr><th>배우자 휴대폰</th><td><input id="bph" type="tel"></td></tr>
</table></body>"""


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_ai_fill_no_cascade_into_other_person_fields(monkeypatch):
    """의도 단위 멱등 + 타인 칸 가드: 신청인 성명·휴대폰이 이미 채워져 있으면, 같은 패턴에 걸리는
    빈 '가구원 성명'·'배우자 휴대폰'으로 신청인 값이 흘러들지 않는다(감사 확정 HIGH 회귀 락)."""
    monkeypatch.setenv("RPA_AI_FILL", "1")
    from playwright.async_api import async_playwright
    from rpa.ai_fill import ai_fill

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()
            await pg.set_content(_HTML_MULTI)
            out = await ai_fill(pg, pg, {"name": "김주형", "phone_tail": "12345678"}, page_hint="복지로 신청서")
            vals = await pg.evaluate(
                "() => ({anm: document.getElementById('anm').value, aph: document.getElementById('aph').value,"
                " gnm: document.getElementById('gnm').value, bph: document.getElementById('bph').value})")
            await b.close()
            return out, vals

    out, vals = asyncio.new_event_loop().run_until_complete(run())
    assert vals["anm"] == "김주형" and vals["aph"] == "12345678"  # 신청인 칸은 그대로
    assert vals["gnm"] == "" and vals["bph"] == ""                # 🚫 타인 칸엔 신청인 값이 안 들어감


def test_plan_respects_intent_drops_other_person_target():
    """LLM 계획 가드(순수 유닛) — LLM이 '배우자 성명' 칸 idx로 name 을 채우려 해도 그 행동은 버려진다."""
    from rpa.ai_fill import _plan_respects_intent
    fields = [{"idx": 0, "name": "배우자 성명"}, {"idx": 1, "name": "신청인 성명"}]
    plan = [{"action": "fill", "idx": 0, "key": "name"}, {"action": "fill", "idx": 1, "key": "name"}]
    kept = _plan_respects_intent(plan, fields)
    assert kept == [{"action": "fill", "idx": 1, "key": "name"}]  # 배우자(idx0) 제거, 신청인(idx1)만


def test_prompt_fields_drops_button_text_when_no_clicks():
    """프롬프트 필드 정제(순수 유닛) — 클릭 비활성 시 버튼/링크(innerText PII 가능)는 제외된다."""
    from rpa.ai_fill import _prompt_fields
    fields = [
        {"idx": 0, "role": "textbox", "name": "성명"},
        {"idx": 1, "role": "link", "name": "", "text": "홍길동님"},   # 마이페이지 링크(실명 유출 벡터)
        {"idx": 2, "role": "button", "text": "다음"},
    ]
    out = _prompt_fields(fields, allow_clicks=False)
    assert [f["idx"] for f in out] == [0]                      # 입력칸만 남음
    assert all("text" not in f for f in out)                   # 버튼 텍스트(콘텐츠) 미포함
    # 클릭 활성(옵트인) 시엔 버튼도 포함(클릭 대상 필요) — 그 경우만 텍스트 유지
    out2 = _prompt_fields(fields, allow_clicks=True)
    assert {f["idx"] for f in out2} == {0, 1, 2}


# 📱 복지로 신청서 실측 구조(흐름 기록, 2026-07-21): 휴대폰이 [가운데 4][마지막 4] + 확인 재입력으로 쪼개짐.
#    유선 '전화번호'·타인(배우자) 휴대폰 칸도 함께 둬, 신청인 휴대폰만 정확히 나눠 채우는지 검증한다.
_HTML_SPLIT_PHONE = """<!doctype html><meta charset="utf-8"><body>
<input id="nm"  type="text" aria-label="성명">
<input id="rrn" type="text" aria-label="주민등록번호" value="900101-1******" readonly>
<input id="hm"  type="text" aria-label="필수입력. 휴대폰 가운데 자리">
<input id="hl"  type="text" aria-label="필수입력. 휴대폰 마지막 자리">
<input id="hm2" type="text" aria-label="필수입력. 휴대폰 확인 가운데 자리">
<input id="hl2" type="text" aria-label="필수입력. 휴대폰 확인 마지막 자리">
<input id="tm"  type="text" aria-label="전화번호 가운데 자리">
<input id="tl"  type="text" aria-label="전화번호 마지막 자리">
<input id="sm"  type="text" aria-label="배우자 휴대폰 가운데 자리">
</body>"""


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_bokjiro_split_phone_fills_mid_and_last_real_browser(monkeypatch):
    """쪼개진 휴대폰 폼: phone_tail(8자리)을 가운데(앞4)/마지막(뒤4)로 나눠 채우고, 확인 재입력 칸까지 채운다.
    유선 전화번호·타인(배우자) 휴대폰 칸엔 넣지 않는다. (흐름 기록으로 잡은 실결함 회귀 락)"""
    monkeypatch.setenv("RPA_AI_FILL", "1")
    from playwright.async_api import async_playwright
    from rpa.ai_fill import ai_fill

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()
            await pg.set_content(_HTML_SPLIT_PHONE)
            out = await ai_fill(pg, pg, {"name": "김주형", "phone_tail": "12345678"}, page_hint="복지로 신청서(신청인 정보)")
            vals = await pg.evaluate(
                "() => ({nm: nm.value, hm: hm.value, hl: hl.value, hm2: hm2.value, hl2: hl2.value,"
                " tm: tm.value, tl: tl.value, sm: sm.value})")
            await b.close()
            return out, vals

    out, vals = asyncio.new_event_loop().run_until_complete(run())
    assert vals["hm"] == "1234" and vals["hl"] == "5678"    # 휴대폰 가운데/마지막을 나눠 채움
    assert vals["hm2"] == "1234" and vals["hl2"] == "5678"  # 확인 재입력 칸도 채움
    assert vals["tm"] == "" and vals["tl"] == ""            # 🚫 유선 전화번호엔 휴대폰 안 넣음
    assert vals["sm"] == ""                                 # 🚫 배우자 휴대폰(타인 칸)엔 안 넣음
    assert vals["nm"] == "김주형"                            # 성명은 정상 입력


def test_split_phone_plan_unit():
    """순수 유닛 — 쪼개진 구조면 mid/last 계획을 만들고, 단일 칸 폼이면 빈 계획(기존 경로 유지)."""
    from rpa.ai_fill import _split_phone_plan
    split_fields = [
        {"idx": 0, "role": "textbox", "name": "휴대폰 가운데 자리"},
        {"idx": 1, "role": "textbox", "name": "휴대폰 마지막 자리"},
        {"idx": 2, "role": "textbox", "name": "전화번호 마지막 자리"},   # 유선 — 제외
        {"idx": 3, "role": "textbox", "name": "배우자 휴대폰 마지막 자리"},  # 타인 — 제외
    ]
    plan, used, vals = _split_phone_plan(split_fields, {"phone_tail": "12345678"})
    assert vals == {"__phone_mid": "1234", "__phone_last": "5678"}
    assert sorted(used) == [0, 1]                                     # 신청인 휴대폰 2칸만
    # 단일 휴대폰 칸(가운데/마지막 구분 없음)이면 쪼개지 않는다 → 기존 phone_tail 경로
    single = [{"idx": 0, "role": "textbox", "name": "휴대폰 번호"}]
    assert _split_phone_plan(single, {"phone_tail": "12345678"})[0] == []


# 복지로형 '라벨이 입력칸과 다른 컨테이너에 있는' 휴대폰 필드 — 행 라벨 매칭이 닿지 않아
# 이름·주민번호는 채워지는데 휴대폰만 빈칸이던 실사용 제보 재현. '010 select 바로 뒤 입력칸'
# 구조 폴백이 뒷자리를 정확히 채워야 한다(라벨 위치 무관).
_HTML_PHONE_DISTANT = """<!doctype html><meta charset="utf-8"><body>
<table>
<tr><th>성명</th><td><input id="nm" type="text"></td></tr>
<tr><th>주민등록번호</th><td><input id="b" type="text"></td></tr>
</table>
<div class="lbl">휴대폰 번호</div>
<div class="fld"><span><select id="h"><option>010</option><option>011</option></select></span><span><input id="p" type="tel"></span></div>
</body>"""


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_bokjiro_autofill_phone_select_adjacent_fallback_real_browser():
    """휴대폰 라벨이 행에서 멀어 매칭 실패해도 '010 select 뒤 입력칸' 폴백으로 뒷자리를 채운다.
    (이름·주민번호는 라벨로 정상 매칭 — 휴대폰만 폴백 경로로 성립하는지 격리 검증)"""
    from playwright.async_api import async_playwright
    from rpa.apply_rpa import _autofill_bokjiro_auth

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()
            await pg.set_content(_HTML_PHONE_DISTANT)
            out = await _autofill_bokjiro_auth(
                [pg], pg, {"name": "김주형", "birth_date": "20010601", "phone": "01012345678"})
            vals = await pg.evaluate(
                "() => ({nm: document.getElementById('nm').value,"
                " b: document.getElementById('b').value, p: document.getElementById('p').value})")
            await b.close()
            return out, vals

    out, vals = asyncio.new_event_loop().run_until_complete(run())
    assert out["name"] is True and out["birth"] is True and out["phone"] is True
    assert vals["nm"] == "김주형"       # 성명(라벨 매칭)
    assert vals["b"] == "010601"        # 주민번호 앞자리(라벨 매칭)
    assert vals["p"] == "12345678"      # 휴대폰 뒷자리 — 010 select 뒤 폴백으로 정확히
