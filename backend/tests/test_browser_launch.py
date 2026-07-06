"""브라우저 폴백 우선순위 테스트 — 크롬 미설치 PC에서도 자동발급이 끊기지 않도록.

_browser_candidates() 의 순서가 회귀하지 않게 고정한다:
  · Windows: chrome → msedge(항상 선탑재) → ''(번들 chromium)
  · mac/linux: ''(번들 우선, 동작 불변) → chrome
  · 명시 채널(RPA_BROWSER_CHANNEL)은 최우선 + 중복 제거
"""
import pytest

from rpa import base


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
