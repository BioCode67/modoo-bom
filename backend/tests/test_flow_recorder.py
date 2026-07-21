"""🎬 흐름 기록기(flow recorder) 검증 — RPA_FLOW_RECORD=1 일 때 take_screenshot 이 '지나간 화면'의
구조를 중복 없이 한 파일에 남기고, 값(이름·주민번호 등)은 절대 담지 않는지(프라이버시 계약) 실Chromium으로 확인.

배경: 개발 환경에서 실제 gov 화면을 못 보는 제약을 우회하는 도구다. '값이 새면' 도구 자체가 프라이버시
위반이 되므로, 실제 입력값을 넣은 폼을 캡처해도 그 값 문자열이 결과에 없다는 것을 회귀로 못 박는다.
"""
import asyncio
import glob
import json
import os

import pytest


def _chromium_path():
    hits = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
    return hits[0] if hits else None


_SCREEN1 = """<!doctype html><meta charset="utf-8"><body>
<h1>복지로 로그인</h1>
<input id="nm" type="text"><input id="ph" type="tel">
<button>인증 요청</button><button>인증 완료</button></body>"""

_SCREEN2 = """<!doctype html><meta charset="utf-8"><body>
<h1>서비스 선택</h1>
<label><input type="checkbox" id="c">기초연금</label>
<select id="sel"><option>선택</option><option>노년</option></select>
<button>저장 후 다음 단계</button></body>"""

_SCREEN3 = """<!doctype html><meta charset="utf-8"><body>
<h1>신청 양식</h1>
<input id="a" type="text"><input id="b" type="text">
<textarea id="t"></textarea><button>제출</button><button>확인</button></body>"""

# 진짜 개인정보처럼 보이는 값 — 이 문자열들이 흐름 파일에 '단 하나도' 나오면 안 된다.
_SECRET_NAME = "홍길동시크릿값"
_SECRET_RRN = "9001011234567"
_SECRET_PHONE = "01098765432"


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_flow_recorder_captures_distinct_screens_without_values(monkeypatch, tmp_path):
    monkeypatch.setenv("RPA_FLOW_RECORD", "1")
    from playwright.async_api import async_playwright
    from rpa import diagnostics as dg
    from rpa.base import take_screenshot

    # 모듈 전역 상태(마지막 서명·단계 수)를 이 테스트만의 깨끗한 상태로 리셋
    dg._flow_state.clear()
    dg._flow_state.update({"last_sig": None, "n": 0})

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()

            # 화면1 — 실제 값까지 입력한 상태로 캡처(값 유출 검증용)
            await pg.set_content(_SCREEN1)
            await pg.fill("#nm", _SECRET_NAME)
            await pg.fill("#ph", _SECRET_PHONE)
            await take_screenshot(pg)          # 1번째 기록
            await take_screenshot(pg)          # 같은 화면 → 중복이라 기록 안 됨

            # 화면2 — 구조가 바뀌면 새 단계로 기록
            await pg.set_content(_SCREEN2)
            await take_screenshot(pg)          # 2번째 기록

            # 화면3 — 또 다른 값 입력 후 캡처
            await pg.set_content(_SCREEN3)
            await pg.fill("#a", _SECRET_RRN)
            await take_screenshot(pg)          # 3번째 기록

            await b.close()

    # take_screenshot 은 base.DOCS_DIR 에 쓰므로 그걸 tmp 로 돌린다
    monkeypatch.setattr("rpa.base.DOCS_DIR", tmp_path)
    asyncio.new_event_loop().run_until_complete(run())

    files = glob.glob(str(tmp_path / "_flow" / "flow_*.jsonl"))
    assert files, "흐름 파일이 생성돼야 한다"
    raw = open(files[0], encoding="utf-8").read()

    # 1) 중복 없이 '구조가 다른 화면 3개'만 기록됐는지
    lines = [ln for ln in raw.splitlines() if ln.strip()]
    assert len(lines) == 3, f"구별되는 화면 3개여야 하는데 {len(lines)}개"
    steps = [json.loads(ln) for ln in lines]
    assert [s["step"] for s in steps] == [1, 2, 3]

    # 2) 각 화면의 '구조'는 담겼는지(버튼/입력칸이 보여야 함)
    #    화면1엔 '인증 요청/완료' 마커, 화면2엔 '신청/발급' 계열은 없지만 콤보박스, 화면3엔 '제출/확인'
    markers_all = sum(([m for f in s.get("frames", []) for m in f.get("markers", [])] for s in steps), [])
    assert any("인증" in m for m in markers_all), "화면1 인증 마커가 구조에 있어야"
    assert any("제출" in m or "확인" in m for m in markers_all), "화면3 제출/확인 마커가 구조에 있어야"

    # 3) ⚠️ 프라이버시 계약 — 실제 입력값은 '단 하나도' 새면 안 된다
    for secret in (_SECRET_NAME, _SECRET_RRN, _SECRET_PHONE):
        assert secret not in raw, f"값 유출 금지 위반: {secret!r} 이 흐름 파일에 있음"

    # 4) read_flow 로 읽어도 동일(엔드포인트 경로)
    got = dg.read_flow(dirpath=str(tmp_path))
    assert got["available"] and got["count"] == 3
    assert _SECRET_NAME not in json.dumps(got, ensure_ascii=False)


def test_flow_recording_off_by_default(monkeypatch):
    """기본 OFF — 환경변수 없으면 기록 안 함(심사/일반 사용 무영향)."""
    from rpa import diagnostics as dg
    monkeypatch.delenv("RPA_FLOW_RECORD", raising=False)
    assert dg.flow_recording_on() is False
    for v in ("1", "true", "On", "yes"):
        monkeypatch.setenv("RPA_FLOW_RECORD", v)
        assert dg.flow_recording_on() is True


def test_read_flow_absent_when_empty(tmp_path):
    """기록이 없으면 available=False(기록 OFF/미실행 시 프론트가 안내로 폴백)."""
    from rpa import diagnostics as dg
    assert dg.read_flow(dirpath=str(tmp_path)).get("available") is False
