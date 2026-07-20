"""공용 간편인증 오토필(auth_autofill) — 실브라우저 회귀 락.

계약: ① 고정 ID(#oacx_*) 경로가 1순위로 동작(기존 nhis/gov24 동작 보존)
② ID가 없는 개편 위젯에선 ai_fill 결정론 의미매칭 폴백(LLM 키 불필요)이 라벨로 채운다
③ RPA_AI_FILL=0 밸브는 '의미 폴백'만 끈다(ID 경로는 항상 동작)
④ '인증 요청' 자동 클릭은 자식 프레임에 있어도 눌린다(프레임 분리 대응)
부분 성공을 완료로 과장하지 않는 판정(3키 전부)은 호출부(nhis/work24)가 담당한다.
"""
import asyncio
import glob

import pytest

# 검증된 고정 ID 위젯(기존 nhis/gov24 마크업 축약) — ID 경로가 잡아야 한다
_HTML_ID = """<!doctype html><meta charset="utf-8"><body>
<input id="oacx_name" type="text"><input id="oacx_birth" type="text"><input id="oacx_phone2" type="tel">
<label><input type="checkbox" id="totalAgree">전체동의</label></body>"""

# 개편 위젯 가정: oacx ID 없음 — 라벨(tr>th) 기반 의미 매칭만이 채울 수 있다
_HTML_SEMANTIC = """<!doctype html><meta charset="utf-8"><body>
<table>
<tr><th>이름</th><td><input id="nm" type="text"></td></tr>
<tr><th>생년월일</th><td><input id="bd" type="text"></td></tr>
<tr><th>휴대폰 번호</th><td>
  <select id="ph1"><option value="">선택</option><option>010</option><option>011</option></select>
  <input id="ph2" type="tel"></td></tr>
</table>
<label><input type="checkbox" id="totalAgree">전체동의</label></body>"""

_INFO = {"user_name": "김순자", "birth_date": "19380315", "phone": "01055557777"}


def _chromium_path():
    hits = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
    return hits[0] if hits else None


def _run(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


async def _open(pw, html):
    b = await pw.chromium.launch(executable_path=_chromium_path())
    pg = await (await b.new_context()).new_page()
    await pg.set_content(html)
    return b, pg


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_autofill_id_path_fills_and_agrees(monkeypatch):
    """①: 고정 ID 위젯 — 3키 전부 채우고 값 일치, 전체동의까지 체크."""
    monkeypatch.setenv("RPA_AI_FILL", "1")
    from playwright.async_api import async_playwright
    from rpa.auth_autofill import autofill_easy_auth

    async def run():
        async with async_playwright() as pw:
            b, pg = await _open(pw, _HTML_ID)
            got = await autofill_easy_auth(pg, _INFO)
            vals = await pg.evaluate(
                "() => ({n: document.getElementById('oacx_name').value,"
                " b: document.getElementById('oacx_birth').value,"
                " p: document.getElementById('oacx_phone2').value,"
                " a: document.getElementById('totalAgree').checked})")
            await b.close()
            return got, vals

    got, vals = _run(run())
    assert got["name"] and got["birth"] and got["phone"] and got["agree"]
    assert vals == {"n": "김순자", "b": "19380315", "p": "55557777", "a": True}


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_autofill_semantic_fallback_on_no_id_widget(monkeypatch):
    """②: oacx ID가 없는 개편 위젯 — 라벨 의미매칭(키 불필요)으로 3키 채움 + 앞자리 select까지."""
    monkeypatch.setenv("RPA_AI_FILL", "1")
    from playwright.async_api import async_playwright
    from rpa.auth_autofill import autofill_easy_auth

    async def run():
        async with async_playwright() as pw:
            b, pg = await _open(pw, _HTML_SEMANTIC)
            got = await autofill_easy_auth(pg, _INFO)
            vals = await pg.evaluate(
                "() => ({n: document.getElementById('nm').value,"
                " b: document.getElementById('bd').value,"
                " h: document.getElementById('ph1').value,"
                " p: document.getElementById('ph2').value,"
                " a: document.getElementById('totalAgree').checked})")
            await b.close()
            return got, vals

    got, vals = _run(run())
    assert got["name"] and got["birth"] and got["phone"] and got["agree"]
    assert vals["n"] == "김순자" and vals["b"] == "19380315" and vals["p"] == "55557777"
    assert vals["h"] == "010"  # 휴대폰 앞자리 select도 의미 매칭(combobox 선호)으로 선택됨
    assert vals["a"] is True


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_autofill_valve_disables_semantic_but_not_id(monkeypatch):
    """③: RPA_AI_FILL=0 — 의미 폴백은 꺼지고(ID 없는 위젯 → 전부 False), ID 경로는 그대로 동작."""
    monkeypatch.setenv("RPA_AI_FILL", "0")
    from playwright.async_api import async_playwright
    from rpa.auth_autofill import autofill_easy_auth

    async def run():
        async with async_playwright() as pw:
            b, pg = await _open(pw, _HTML_SEMANTIC)
            got_sem = await autofill_easy_auth(pg, _INFO)
            await pg.set_content(_HTML_ID)
            got_id = await autofill_easy_auth(pg, _INFO)
            await b.close()
            return got_sem, got_id

    got_sem, got_id = _run(run())
    assert not (got_sem["name"] or got_sem["birth"] or got_sem["phone"])  # 밸브가 의미 폴백 차단
    assert got_id["name"] and got_id["birth"] and got_id["phone"]          # ID 경로는 밸브 무관


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_request_easy_auth_reaches_child_frame():
    """④: '인증 요청' 버튼이 자식 프레임에 있어도 클릭된다(프레임 분리 3대 갭과 동일 대응)."""
    from playwright.async_api import async_playwright
    from rpa.auth_autofill import request_easy_auth

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()
            await pg.set_content('<h1>간편인증</h1><iframe src="about:blank" width="300" height="120"></iframe>')
            for _ in range(20):
                if len(pg.frames) > 1:
                    break
                await asyncio.sleep(0.1)
            child = pg.frames[1]
            await child.set_content(
                "<button onclick=\"document.title='req'\">인증 요청</button>")
            ok = await request_easy_auth(pg)
            title = await child.title()
            await b.close()
            return ok, title

    ok, title = _run(run())
    assert ok is True and title == "req"


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_gov24_autofill_resilient_to_missing_name_field():
    """gov24 _autofill_auth_form: #oacx_name 이 없는 변형 폼에서도 생년월일·휴대폰·전체동의는 채운다.
    (한 칸이 없을 때 timeout 없는 fill 이 30초 블록+예외로 나머지 입력을 통째 스킵하던 갭 회귀 락 — 감사 확정)"""
    from playwright.async_api import async_playwright
    from rpa.gov24_rpa import _autofill_auth_form

    html = ("<body><input id='oacx_birth' type='text'><input id='oacx_phone2' type='tel'>"
            "<label><input type='checkbox' id='totalAgree'>전체동의</label></body>")  # oacx_name 없음

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()
            await pg.set_content(html)
            filled = await _autofill_auth_form(
                pg, {"user_name": "김순자", "birth_date": "19380315", "phone": "01055557777"})
            vals = await pg.evaluate(
                "() => ({b: document.getElementById('oacx_birth').value,"
                " p: document.getElementById('oacx_phone2').value,"
                " a: document.getElementById('totalAgree').checked})")
            await b.close()
            return filled, vals

    filled, vals = _run(run())
    assert filled is True
    assert vals["b"] == "19380315" and vals["p"] == "55557777" and vals["a"] is True  # 이름칸 없어도 나머지 채움
