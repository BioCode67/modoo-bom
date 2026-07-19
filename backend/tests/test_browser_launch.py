"""브라우저 폴백 우선순위 + launch_browser 폴백 루프 테스트 — 크롬 미설치 PC에서도 자동발급 유지.

_browser_candidates() 순서 + launch_browser() 가 실패 채널을 건너뛰고 첫 성공을 반환/전부 실패 시
액션 가능한 예외를 던지는지 검증(회귀 시 설치본에서 자동발급이 launch 단계에서 통째로 죽음).
"""
import asyncio

import pytest

from rpa import base


def _run(coro):
    """코루틴을 격리된 루프에서 실행하고, 끝나면 '새 루프'를 현재 루프로 남긴다.
    (asyncio.run은 전역 루프를 닫아, 뒤이어 도는 다른 테스트의 get_event_loop() 를 깨뜨리므로 회피.)"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


class _FakeBrowser:
    def __init__(self, channel):
        self.channel = channel


class _FakeChromium:
    """지정한 채널만 실패시키는 가짜 playwright.chromium."""
    def __init__(self, fail_channels):
        self.fail_channels = fail_channels
        self.attempts = []

    async def launch(self, **opts):
        ch = opts.get("channel", "")  # '' = 번들 chromium
        self.attempts.append(ch)
        if ch in self.fail_channels:
            raise RuntimeError(f"no such browser: {ch or 'chromium'}")
        return _FakeBrowser(ch)


class _FakePw:
    def __init__(self, fail_channels):
        self.chromium = _FakeChromium(fail_channels)


def test_launch_skips_failing_channel_and_sets_active(monkeypatch):
    monkeypatch.setattr(base.sys, "platform", "win32")
    monkeypatch.delenv("RPA_BROWSER_CHANNEL", raising=False)
    monkeypatch.delenv("RPA_ACTIVE_BROWSER", raising=False)
    pw = _FakePw(fail_channels={"chrome"})  # 크롬 미설치 → msedge로 폴백
    browser = _run(base.launch_browser(pw, slow_mo=0))
    assert browser.channel == "msedge"
    assert pw.chromium.attempts[0] == "chrome"  # 크롬 먼저 시도
    assert base.os.environ.get("RPA_ACTIVE_BROWSER") == "msedge"


def test_launch_all_fail_raises_actionable(monkeypatch):
    monkeypatch.setattr(base.sys, "platform", "win32")
    monkeypatch.delenv("RPA_BROWSER_CHANNEL", raising=False)
    pw = _FakePw(fail_channels={"chrome", "msedge", ""})  # 전부 실패
    with pytest.raises(RuntimeError) as ei:
        _run(base.launch_browser(pw, slow_mo=0))
    msg = str(ei.value)
    assert "playwright install chromium" in msg  # 조치 안내 포함
    assert "chrome" in msg and "msedge" in msg   # 시도한 채널 표기


def test_win32_default_order(monkeypatch):
    monkeypatch.setattr(base.sys, "platform", "win32")
    monkeypatch.delenv("RPA_BROWSER_CHANNEL", raising=False)
    assert base._browser_candidates() == ["chrome", "msedge", ""]


def test_non_win32_bundled_first(monkeypatch):
    monkeypatch.setattr(base.sys, "platform", "darwin")
    monkeypatch.delenv("RPA_BROWSER_CHANNEL", raising=False)
    # 맥은 번들 chromium 우선(기존 동작 불변) → 없으면 chrome
    assert base._browser_candidates() == ["", "chrome"]


def test_forced_channel_first_no_dup(monkeypatch):
    monkeypatch.setattr(base.sys, "platform", "win32")
    monkeypatch.setenv("RPA_BROWSER_CHANNEL", "msedge")
    order = base._browser_candidates()
    assert order[0] == "msedge"          # 명시 채널이 최우선
    assert order.count("msedge") == 1      # 중복 없음
    assert "chrome" in order and "" in order


def test_forced_empty_means_bundled_first(monkeypatch):
    monkeypatch.setattr(base.sys, "platform", "win32")
    monkeypatch.setenv("RPA_BROWSER_CHANNEL", "")
    order = base._browser_candidates()
    assert order[0] == ""                  # 빈 문자열 명시 = 번들 chromium 최우선
    assert order.count("") == 1


def test_recent_issued_docs(monkeypatch, tmp_path):
    """발급 서류를 최신순 + 사람이 읽는 이름(타임스탬프 제거)으로 나열."""
    import time
    d = tmp_path / "모두봄서류"
    d.mkdir()
    (d / "신분증_홍길동_2026-07-08_1010.jpg").write_bytes(b"\xff\xd8\xff")  # '내 서류함' 등록 사진(JPG)
    time.sleep(0.02)
    (d / "주민등록등본_20260708_101500.pdf").write_bytes(b"%PDF old")
    time.sleep(0.02)
    (d / "가족관계증명서_20260708_101600.pdf").write_bytes(b"%PDF new")
    (d / "무관한파일.txt").write_text("x")  # PDF/PNG/JPG 아님 → 제외
    monkeypatch.setattr(base, "DOCS_DIR", d)
    docs = base.recent_issued_docs()
    names = [n for n, _ in docs]
    assert names[0] == "가족관계증명서"  # 최신 먼저
    assert "주민등록등본" in names
    assert "신분증_홍길동" in names  # 등록한 JPG도 글롭에 포함 → 신청 자동첨부 대상
    assert all(".txt" not in p for _, p in docs)  # txt 제외
    assert len(docs) == 3


def test_safe_filename_strips_traversal():
    """발급 문서(PII) 파일명 안전화 — 경로 이탈 문자 제거, 빈 이름은 'document'."""
    out = base._safe_filename("../../etc/pwn")
    assert "/" not in out and "\\" not in out  # 경로 구분자 제거 → 저장 폴더 밖으로 못 나감
    assert base._safe_filename("") == "document"
    assert base._safe_filename('a<b>:"|?*c') == "abc"  # 금지문자 제거


def test_docs_dir_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("MODOOBOM_DOCS_DIR", str(tmp_path / "docs"))
    assert base._default_docs_dir() == (tmp_path / "docs")


def test_docs_dir_parent_is_visible(monkeypatch):
    """기본 저장 폴더의 부모(바탕화면/문서)가 실제 존재해야 — PII가 안 보이는 경로에 남지 않게."""
    monkeypatch.delenv("MODOOBOM_DOCS_DIR", raising=False)
    d = base._default_docs_dir()
    assert d.name == "모두봄서류"
    assert d.parent.exists()


def test_bogus_channel_still_falls_back(monkeypatch):
    """존재하지 않는 채널을 강제해도, 뒤에 실제 후보(chrome/msedge/번들)가 남아 폴백 가능."""
    monkeypatch.setattr(base.sys, "platform", "win32")
    monkeypatch.setenv("RPA_BROWSER_CHANNEL", "bogus")
    order = base._browser_candidates()
    assert order[0] == "bogus"
    assert order[1:] == ["chrome", "msedge", ""]  # 실제 후보로 폴백 경로 확보


def test_provider_loose_match_excludes_sns_links():
    """느슨한 매칭(loose) 오클릭 차단 — 실사용 확정 사고(2026-07-20 새벽 데모) 회귀 고정.

    간편인증 iframe 폴백에서 loose '카카오'가 정부24 푸터의 '카카오스토리' SNS 링크를 클릭해
    story.kakao.com 탭이 열렸다. _click_provider_once 3단계 JS 와 동일한 술어로 검증:
    t = (텍스트+클래스).lower() 에 loose 포함 && exclude 미포함."""
    from rpa.base import AUTH_PROVIDERS

    def loose_hit(provider: str, text_and_class: str) -> bool:
        p = AUTH_PROVIDERS[provider]
        t = text_and_class.lower()
        return any(k.lower() in t for k in p["loose"]) and not any(x.lower() in t for x in p["exclude"])

    # 사고 재현: 푸터 SNS 링크는 차단돼야 한다
    assert not loose_hit("kakao", "정부24 카카오스토리")           # 실제 사고 링크 텍스트
    assert not loose_hit("kakao", "kakaostory sns-link")          # 영문 클래스 변형
    assert not loose_hit("naver", "정부24 네이버 블로그")          # 같은 계열(푸터 블로그 링크)
    # 정상 인증 버튼은 계속 매칭돼야 한다(차단 과잉 방지)
    assert loose_hit("kakao", "카카오 인증서")
    assert loose_hit("kakao", "카카오톡 지갑")
    assert loose_hit("naver", "네이버 인증서")


class _FakeEl:
    """click_provider_in_anyid 의 Playwright locator 최소 흉내(반환 계약 검증용)."""
    def __init__(self, count):
        self._count = count
    async def count(self):
        return self._count
    async def scroll_into_view_if_needed(self):
        return None
    async def click(self):
        return None


def _fake_page(stage1_count, evaluate_result):
    """stage1(Playwright) 매칭 수 + stage2/3(JS evaluate) 반환을 주입하는 가짜 page."""
    class _Loc:
        first = _FakeEl(stage1_count)
    class _Page:
        def locator(self, sel):
            return _Loc()
        async def evaluate(self, script, arg=None):
            return evaluate_result
    return _Page()


def test_click_provider_returns_trusted_on_playwright_click():
    """Playwright 신뢰 클릭 성공 → 'trusted' — 자동 '인증 요청' 게이트를 통과하는 유일한 값(회귀 고정).

    gov24_rpa 는 kakaotalk_clicked == 'trusted' 일 때만 인증요청을 자동 클릭한다. 이 계약이 깨지면
    '인증서비스를 선택하여 주십시오' 오류(실사용 확정 버그)가 재발하므로 여기서 못박는다."""
    r = _run(base.click_provider_in_anyid(_fake_page(1, False), "kakao", attempts=1))
    assert r == "trusted"


def test_click_provider_returns_js_on_evaluate_fallback():
    """stage1 미스 + JS 폴백 클릭 성공 → 'js'(미확정) — 자동 인증요청 게이트에서 제외돼야 한다."""
    r = _run(base.click_provider_in_anyid(_fake_page(0, True), "kakao", attempts=1))
    assert r == "js"


def test_click_provider_returns_false_when_nothing_matches():
    """아무것도 못 찾으면 False — 게이트에서 '요청 안 함'으로 이어져 오류를 피한다."""
    r = _run(base.click_provider_in_anyid(_fake_page(0, False), "kakao", attempts=1))
    assert r is False


def test_health_probe_url_uses_loopback_ipv4():
    """브라우저 자동오픈용 health 폴링은 127.0.0.1 로 — 'localhost'가 IPv6(::1)로 풀려
    서버(127.0.0.1 바인드) 확인이 빗나가 창이 안 열리던 것 방지(실사용 제보 회귀 고정)."""
    import local_server
    assert local_server._health_probe_url("http://localhost:8000/") == "http://127.0.0.1:8000/api/health"
    # 이미 127.0.0.1 이면 그대로, api/health 만 붙는다
    assert local_server._health_probe_url("http://127.0.0.1:8000/") == "http://127.0.0.1:8000/api/health"


def test_open_app_ui_non_win32_uses_default_browser(monkeypatch):
    """맥·리눅스: 앱 UI는 기본 브라우저(webbrowser.open)로 연다(기존 동작 불변)."""
    import local_server
    monkeypatch.setattr(local_server.sys, "platform", "darwin")
    opened = []
    monkeypatch.setattr(local_server.webbrowser, "open", lambda u: opened.append(u) or True)
    local_server._open_app_ui("http://localhost:8000/")
    assert opened == ["http://localhost:8000/"]


def test_open_app_ui_win32_prefers_chrome(monkeypatch):
    """윈도우: 기본 브라우저가 크롬이 아니어도 크롬을 '먼저' 띄운다(webbrowser.open 미사용)."""
    import subprocess

    import local_server
    monkeypatch.setattr(local_server.sys, "platform", "win32")
    # 크롬 실행파일만 '존재'하는 것으로 위장
    monkeypatch.setattr(local_server.os.path, "exists", lambda p: p.endswith("chrome.exe"))
    launched, fell_back = [], []
    monkeypatch.setattr(subprocess, "Popen", lambda args, **k: launched.append(args) or None)
    monkeypatch.setattr(local_server.webbrowser, "open", lambda u: fell_back.append(u) or True)
    local_server._open_app_ui("http://localhost:8000/")
    assert launched and launched[0][0].endswith("chrome.exe")  # 크롬으로 열림
    assert launched[0][1] == "http://localhost:8000/"
    assert fell_back == []  # 기본 브라우저 폴백 안 함


def test_open_app_ui_win32_falls_back_when_no_chrome_edge(monkeypatch):
    """윈도우에서 크롬·엣지 실행파일이 모두 없으면 기본 브라우저로 폴백(무슨 일이 있어도 창은 열림)."""
    import subprocess

    import local_server
    monkeypatch.setattr(local_server.sys, "platform", "win32")
    monkeypatch.setattr(local_server.os.path, "exists", lambda p: False)  # 크롬·엣지 없음
    fell_back = []
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: (_ for _ in ()).throw(AssertionError("Popen 호출 금지")))
    monkeypatch.setattr(local_server.webbrowser, "open", lambda u: fell_back.append(u) or True)
    local_server._open_app_ui("http://localhost:8000/")
    assert fell_back == ["http://localhost:8000/"]


def test_no_sandbox_only_for_bundled_chromium(monkeypatch):
    """--no-sandbox 는 번들 Chromium에만 — 정부 로그인을 하는 실사용 Chrome/Edge의 샌드박스(보안 계층)는 유지."""
    monkeypatch.setattr(base.sys, "platform", "win32")
    # 채널 지정(실브라우저) → --no-sandbox 없음
    monkeypatch.setenv("RPA_BROWSER_CHANNEL", "chrome")
    assert "--no-sandbox" not in base.get_launch_options()["args"]
    # 번들 Chromium(빈 채널) → --no-sandbox 포함(잠긴 PC 회피책)
    monkeypatch.setenv("RPA_BROWSER_CHANNEL", "")
    assert "--no-sandbox" in base.get_launch_options()["args"]


def test_launch_rebuilds_args_per_candidate(monkeypatch):
    """launch_browser 가 후보별로 args 를 재구성: 실브라우저 후보엔 샌드박스 유지, 번들 후보엔 --no-sandbox."""
    monkeypatch.setattr(base.sys, "platform", "win32")
    monkeypatch.delenv("RPA_BROWSER_CHANNEL", raising=False)
    seen = []

    class FakeChromium:
        async def launch(self, **opts):
            seen.append((opts.get("channel", ""), list(opts.get("args", []))))
            raise RuntimeError("skip")  # 전 후보 순회 유도

    class FakePW:
        chromium = FakeChromium()

    import asyncio

    async def run():
        try:
            await base.launch_browser(FakePW(), slow_mo=0)
        except RuntimeError:
            pass

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(run())
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())  # 후속 테스트용 fresh loop
    by_channel = {ch: args for ch, args in seen}
    assert "--no-sandbox" not in by_channel["chrome"]
    assert "--no-sandbox" not in by_channel["msedge"]
    assert "--no-sandbox" in by_channel[""]
