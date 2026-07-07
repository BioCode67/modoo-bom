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


def test_bogus_channel_still_falls_back(monkeypatch):
    """존재하지 않는 채널을 강제해도, 뒤에 실제 후보(chrome/msedge/번들)가 남아 폴백 가능."""
    monkeypatch.setattr(base.sys, "platform", "win32")
    monkeypatch.setenv("RPA_BROWSER_CHANNEL", "bogus")
    order = base._browser_candidates()
    assert order[0] == "bogus"
    assert order[1:] == ["chrome", "msedge", ""]  # 실제 후보로 폴백 경로 확보
