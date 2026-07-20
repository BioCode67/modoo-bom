"""🔬 실패 자가 진단 — 실브라우저로 '실화면 구조'를 PII 없이 캡처하는지 검증.

핵심 계약: 값(이름·주민번호·전화)이 채워진 폼을 캡처해도 그 '값'은 절대 결과에 담기지 않는다
(role·라벨·채움여부·옵션 텍스트·마커만). 사용자가 실패 파일 하나만 공유하면 개발자가 실화면 구조를
정확히 알 수 있는지도 확인.
"""
import asyncio
import glob
import json

import pytest

from rpa import diagnostics as dg

_HTML = """<!doctype html><meta charset="utf-8"><body>
<h1>주민등록표 등본(초본) 발급 신청</h1>
<table>
<tr><th>성명</th><td><input id="nm" type="text" value="홍길동"></td></tr>
<tr><th>주민등록번호</th><td><input id="b" type="text" value="900101"> - <input id="r" type="password" value="1234567"></td></tr>
<tr><th>휴대폰</th><td><input id="p" type="tel" value="01012345678"></td></tr>
<tr><th>주민등록상 주소</th><td>
  <select id="sido"><option>시도 선택</option><option>서울특별시</option><option>경기도</option></select></td></tr>
</table>
<button id="issue">신청하기</button>
<div>카카오 간편인증으로 본인인증을 진행해 주세요.</div>
</body>"""


def _chromium_path():
    hits = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
    return hits[0] if hits else None


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_diagnostics_captures_structure_without_values(tmp_path):
    from playwright.async_api import async_playwright

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()
            await pg.set_content(_HTML)
            diag = await dg.capture(pg, label="등본-주소선택", tried=["select#sido by keyOf", "custom dropdown"],
                                    note="시군구 옵션이 안 나타남")
            await b.close()
            return diag

    diag = asyncio.new_event_loop().run_until_complete(run())
    blob = json.dumps(diag, ensure_ascii=False)

    # ① 구조는 잡혔다 — 라벨(접근성 이름)·역할·옵션·마커
    assert "성명" in blob and "주민등록번호" in blob and "휴대폰" in blob
    assert "combobox" in blob and "서울특별시" in blob  # select 옵션 텍스트(값 아님)
    assert "신청하기" in blob                            # 버튼 텍스트
    frames = diag["frames"]
    assert frames and frames[0]["n"] >= 4
    assert "카카오" in frames[0]["markers"] and "간편인증" in frames[0]["markers"] and "신청하기" in frames[0]["markers"]
    # 시도한 전략·라벨은 담긴다(개발자가 무엇을 해봤는지 알게)
    assert "select#sido by keyOf" in blob and diag["label"] == "등본-주소선택"

    # ② ⚠️ 핵심 프라이버시 계약 — 입력 '값'은 절대 안 담긴다
    assert "홍길동" not in blob        # 성명 값
    assert "900101" not in blob        # 주민번호 앞자리 값
    assert "1234567" not in blob       # 주민번호 뒷자리 값(민감)
    assert "01012345678" not in blob   # 전화번호 값
    # 채움여부(불리언)는 담긴다(값은 아님)
    assert '"filled": true' in blob

    # ③ save()는 파일 하나로 남긴다 — 사용자가 이것만 공유하면 됨
    path = dg.save(diag, str(tmp_path))
    assert path.endswith(".json")
    saved = json.loads(open(path, encoding="utf-8").read())
    assert saved["label"] == "등본-주소선택" and saved["frames"]
    assert "홍길동" not in open(path, encoding="utf-8").read()  # 저장 파일에도 값 없음


def test_diagnostics_summarize_and_url_scrub():
    # URL 쿼리(토큰·PII 가능)는 제거, 요약은 프레임·칸·마커를 한 줄로
    assert dg._safe_url("https://plus.gov.kr/ap/iss.do?token=SECRET&rrn=900101") == "https://plus.gov.kr/ap/iss.do"
    s = dg.summarize({"frames": [{"i": 0, "n": 5, "markers": ["카카오", "신청하기"]}]})
    assert "f0" in s and "칸5" in s and "카카오" in s


@pytest.mark.skipif(_chromium_path() is None, reason="컨테이너 chromium 없음 — 실브라우저 e2e 스킵")
def test_diagnostics_dump_writes_file_and_returns_message(tmp_path):
    """dump()는 capture+save를 한 번에 — 파일로 남기고 안내 문자열(파일명 포함)을 돌려준다(값 없음).

    nhis·work24·gov24·apply가 실패 지점에서 공용으로 부르는 단일 진입점 — 이 계약이 전 모듈 공유의 근거."""
    from playwright.async_api import async_playwright

    async def run():
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path=_chromium_path())
            pg = await (await b.new_context()).new_page()
            await pg.set_content(_HTML)
            msg = await dg.dump(pg, label="등본-예외", dirpath=str(tmp_path),
                                tried=["doc issue flow"], note="예기치 못한 실패")
            await b.close()
            return msg

    msg = asyncio.new_event_loop().run_until_complete(run())
    # 안내 문자열은 저장 파일명을 담아 사용자가 [진단 복사]로 공유하게 유도
    assert "진단 저장" in msg and ".json" in msg
    # 실제로 파일이 남았고, 저장 파일에 값(PII)은 없다 — 구조(라벨)만
    files = glob.glob(str(tmp_path / "_diagnostics" / "*.json"))
    assert files, "dump()이 진단 파일을 남기지 않았다"
    body = open(files[0], encoding="utf-8").read()
    assert "홍길동" not in body and "1234567" not in body and "01012345678" not in body
    assert "성명" in body  # 구조(라벨)는 있다


def test_diagnostics_dump_returns_empty_on_failure():
    """저장 불가(잘못된 경로 등)여도 예외를 던지지 않고 빈 문자열 — 실패 지점에서 무해하게 호출된다.

    호출부는 f'...\\n{_saved}'.rstrip() 이라 ''이면 아무것도 안 붙는다(사용자 메시지 오염 없음)."""
    import os
    import tempfile
    fd, fpath = tempfile.mkstemp()  # dirpath로 '파일'을 주면 save의 mkdir가 실패
    os.close(fd)
    try:
        msg = asyncio.new_event_loop().run_until_complete(dg.dump(None, label="x", dirpath=fpath))
        assert msg == ""
    finally:
        os.unlink(fpath)
