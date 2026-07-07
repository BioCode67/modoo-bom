"""rpa_enabled() fail-closed 게이팅 테스트 — 공개 서버 오배포 시 RPA/PII 자동활성 차단."""
import pytest

from rpa import config


def test_disabled_by_default_no_env(monkeypatch):
    """명시 opt-in 없으면 무조건 비활성(과거 fail-open → 현재 fail-closed)."""
    monkeypatch.delenv("RPA_ENABLED", raising=False)
    monkeypatch.delenv("RPA_DISABLED", raising=False)
    for m in config._CLOUD_MARKERS:
        monkeypatch.delenv(m, raising=False)
    assert config.rpa_enabled() is False


def test_explicit_enable(monkeypatch):
    monkeypatch.setenv("RPA_ENABLED", "1")
    assert config.rpa_enabled() is True


def test_explicit_disable_wins(monkeypatch):
    monkeypatch.setenv("RPA_ENABLED", "0")
    assert config.rpa_enabled() is False


def test_cloud_marker_stays_disabled(monkeypatch):
    """클라우드 마커가 있어도(RPA_ENABLED 미설정) 비활성 — 개인정보 서버 유입 차단."""
    monkeypatch.delenv("RPA_ENABLED", raising=False)
    monkeypatch.setenv("RENDER", "true")
    assert config.rpa_enabled() is False


def test_enable_but_no_playwright(monkeypatch):
    """명시 활성이라도 playwright 미설치면 False(launch 크래시 대신 정직한 게이팅)."""
    monkeypatch.setenv("RPA_ENABLED", "1")
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *a, **k):
        if name == "playwright":
            raise ImportError("no playwright")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert config.rpa_enabled() is False
